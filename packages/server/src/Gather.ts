import {
  CatalogUnavailable,
  type CatalogEntry,
  IndicatorId,
  Source,
  SourceUnavailable,
} from "@civicdata/domain"
import { Array as Arr, Context, DateTime, Effect, Layer, Option, Schema, Stream } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { tables } from "./Catalog.ts"
import { database, Step } from "./CatalogBuild.ts"
import { type Combination, Eurostat, isFinal, type Skip } from "./Eurostat.ts"
import { Pace } from "./Pace.ts"
import {
  byCountryYear,
  hashOf,
  judge,
  keyOf,
  type Place,
  type Stored,
  Store,
  Verdict,
} from "./Store.ts"
import { datasetOf, WorldBank } from "./WorldBank.ts"

// World Bank indicators per step. The World Bank's bulk download of one is
// a ZIP of about 50 KB, served in a tenth of a second, so 50 asked two at a
// time take the half minute the 120-a-minute budget allows.
const perStep = 50

const together = 2

// Eurostat datasets per step: up to 50, while their values add up to five
// million, so a step reads a few bulk files of the usual size or one large
// one. A dataset counts every value Eurostat holds, regions and other
// frequencies included, of which a run keeps the annual country ones.
const perStepValues = 5_000_000

// Larger datasets are skipped. Reading one takes about half a second of CPU
// per million values, and stores up to 50,000 series (government spending
// by function, at 21 million values); the largest hold 490 million. 2% of
// datasets are larger.
const largest = 25_000_000

// Series of one dataset stored at once.
const writing = 16

// What happened to each series a step offered: stored, unchanged (the
// stored series already holds the same values), held back, or failed (the
// source or the store did not answer).
const Outcome = Schema.Literals(["Stored", "Unchanged", "Held", "Failed"])

type Outcome = typeof Outcome.Type

// What a step saves: where the next step starts, null once the catalog is
// done, how many series it stored, found unchanged or held back, and how
// many indicators it skipped or failed to gather. A World Bank indicator is
// one series; a Eurostat dataset holds one per combination of its
// dimensions.
type Gathered = {
  readonly after: string | null
  readonly stored: number
  readonly unchanged: number
  readonly held: number
  readonly skipped: number
  readonly failed: number
}

interface Interface {
  readonly worldBank: {
    // The World Development Indicators' release to gather, or null when the
    // last complete run gathered it. It fails while the catalog has no World
    // Bank entries, since a run gathers what the catalog lists: recording
    // the release then would store nothing until the next one.
    readonly check: Effect.Effect<string | null, SourceUnavailable | CatalogUnavailable>
    // Gathers the series of the catalog's World Bank indicators after
    // `after`, in code order, and answers what it did.
    readonly gather: (options: { version: string; after: string }) => Effect.Effect<Gathered>
    // Records the release as gathered, so the next run with the same one
    // stops after its check.
    readonly finish: (version: string) => Effect.Effect<void>
  }
  readonly eurostat: {
    // Records each catalog dataset's release, as Eurostat's table of
    // contents dates it, and answers how many have a release not gathered
    // yet: none while the catalog has no Eurostat entries. Each dataset
    // records its own release, so a run before the catalog's first build
    // records nothing.
    readonly check: Effect.Effect<number, SourceUnavailable>
    // Gathers the catalog's datasets after `after` whose release moved, in
    // code order, and records each one's release once it is gathered or
    // skipped. A dataset dated today stays ungathered, since Eurostat may
    // publish it again at 23:00.
    readonly gather: (after: string) => Effect.Effect<Gathered>
  }
}

// A run that could not gather some series: their release is not recorded,
// so the next run asks for them again.
export class GatherFailed extends Schema.TaggedError<
  GatherFailed,
  { readonly brand: unique symbol }
>()("GatherFailed", { sources: Schema.Array(Source), failed: Schema.Int }) {}

const PlacesJson = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ country: Schema.String, year: Schema.Int })),
)

const KeysJson = Schema.fromJsonString(Schema.Array(Schema.String))

const ReleasesJson = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ scope: Schema.String, version: Schema.String, size: Schema.Int })),
)

// A dataset waiting to be gathered, with what the catalog calls it.
const Pending = Schema.Struct({
  indicator: IndicatorId,
  name: Schema.NonEmptyString,
  definition: Schema.String,
  version: Schema.String,
  size: Schema.Int,
})

type Pending = typeof Pending.Type

// The first datasets of `pending` whose values add up to `perStepValues`,
// at least one.
const batchOf = (pending: ReadonlyArray<Pending>) => {
  let total = 0

  return pending.filter((dataset, at) => {
    total += dataset.size

    return at === 0 || total <= perStepValues
  })
}

const none: Gathered = { after: null, stored: 0, unchanged: 0, held: 0, skipped: 0, failed: 0 }

// Gathers each source's series into the store: on a schedule, it asks a
// source for every country and year of each indicator in the catalog and
// stores each series, unless the stored one already holds the same values
// or the candidate would lose some of them (the hold-back rule in Store.ts).
// The OECD will add its own check and gather steps beside these, sharing the
// store, the rule and the tables.
export class Gather extends Context.Service<Gather, Interface>()("@civicdata/server/Gather") {
  static readonly layer = Layer.effect(
    Gather,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const store = yield* Store
      const worldBank = yield* WorldBank
      const eurostat = yield* Eurostat

      // The catalog's, which a run may read before any catalog build has
      // made them.
      yield* tables

      // The release each scope was last gathered from in full: a source with
      // one release for all its data (the World Bank), or one dataset.
      yield* sql`
        CREATE TABLE IF NOT EXISTS series_version (
          scope TEXT PRIMARY KEY,
          version TEXT NOT NULL
        )
      `
      // The candidates held back, one per series: the latest, why, and the
      // country-years it lost. A series' row goes once a candidate replaces
      // it or matches it again.
      yield* sql`
        CREATE TABLE IF NOT EXISTS series_held (
          series TEXT PRIMARY KEY,
          reason TEXT NOT NULL,
          lost TEXT NOT NULL,
          version TEXT NOT NULL,
          retrieved_at TEXT NOT NULL
        )
      `
      // The latest release of each dataset, as its source dates it, and how
      // many values it holds: a run gathers the datasets whose release
      // differs from the one in series_version.
      yield* sql`
        CREATE TABLE IF NOT EXISTS series_release (
          scope TEXT PRIMARY KEY,
          version TEXT NOT NULL,
          size INTEGER NOT NULL
        )
      `
      // The datasets a run could not store, why, and the release it read.
      yield* sql`
        CREATE TABLE IF NOT EXISTS series_skipped (
          scope TEXT PRIMARY KEY,
          reason TEXT NOT NULL,
          version TEXT NOT NULL
        )
      `

      const gathered = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Schema.Struct({ version: Schema.String }),
        execute: (scope) => sql`SELECT version FROM series_version WHERE scope = ${scope}`,
      })

      // The catalog's published World Bank entries after `after`, in code
      // order. The catalog is an FTS5 table, so the order is a sort of the
      // source's 1,500 rows; that is cheap next to one request.
      const listed = SqlSchema.findAll({
        Request: Schema.String,
        Result: Schema.Struct({
          indicator: IndicatorId,
          name: Schema.NonEmptyString,
          definition: Schema.String,
        }),
        execute: (after) => sql`
          SELECT catalog.indicator, catalog.name, catalog.definition FROM catalog
          JOIN catalog_current AS current
            ON current.source = catalog.source AND current.generation = catalog.generation
          WHERE catalog.source = ${"World Bank" satisfies Source} AND catalog.indicator > ${after}
          ORDER BY catalog.indicator
          LIMIT ${perStep}
        `,
      })

      const catalogued = SqlSchema.findAll({
        Request: Source,
        Result: Schema.Struct({ indicator: IndicatorId }),
        execute: (source) => sql`
          SELECT catalog.indicator FROM catalog
          JOIN catalog_current AS current
            ON current.source = catalog.source AND current.generation = catalog.generation
          WHERE catalog.source = ${source}
        `,
      })

      // The catalog's Eurostat datasets after `after` whose release was not
      // gathered, in code order.
      const pending = SqlSchema.findAll({
        Request: Schema.String,
        Result: Pending,
        execute: (after) => sql`
          SELECT catalog.indicator, catalog.name, catalog.definition, release.version, release.size
          FROM catalog
          JOIN catalog_current AS current
            ON current.source = catalog.source AND current.generation = catalog.generation
          JOIN series_release AS release ON release.scope = catalog.indicator
          LEFT JOIN series_version AS done ON done.scope = catalog.indicator
          WHERE catalog.source = ${"Eurostat" satisfies Source} AND catalog.indicator > ${after}
            AND (done.version IS NULL OR done.version != release.version)
          ORDER BY catalog.indicator
          LIMIT ${perStep}
        `,
      })

      const published = SqlSchema.findOneOption({
        Request: Source,
        Result: Schema.Struct({ generation: Schema.Int }),
        execute: (source) => sql`SELECT generation FROM catalog_current WHERE source = ${source}`,
      })

      const record = (scope: string, version: string) => sql`
        INSERT INTO series_version (scope, version) VALUES (${scope}, ${version})
        ON CONFLICT (scope) DO UPDATE SET version = excluded.version
      `

      const hold = Effect.fn("Gather.hold")(function* (
        candidate: Stored,
        { reason, lost }: { reason: "Empty" | "Lost"; lost: ReadonlyArray<Place> },
      ) {
        const places = yield* Schema.encodeEffect(PlacesJson)(lost)
        const at = DateTime.formatIso(candidate.retrievedAt)
        const key = keyOf({ indicator: candidate.indicator.id, dimensions: candidate.dimensions })

        yield* Effect.logWarning("Held back a series", key, reason, lost.length)
        yield* sql`
          INSERT INTO series_held (series, reason, lost, version, retrieved_at)
          VALUES (${key}, ${reason}, ${places}, ${candidate.version}, ${at})
          ON CONFLICT (series) DO UPDATE SET reason = excluded.reason, lost = excluded.lost,
            version = excluded.version, retrieved_at = excluded.retrieved_at
        `
      })

      // Stores the candidate unless the stored series holds the same values
      // (compared by hash, so only a changed series is read) or the hold-back
      // rule keeps the stored one.
      const offer = Effect.fn("Gather.offer")(function* (
        candidate: Stored,
        stored: Option.Option<string>,
      ) {
        const hash = yield* hashOf(candidate)

        if (Option.exists(stored, (found) => found === hash)) {
          return "Unchanged" satisfies Outcome
        }

        const current = yield* store.read({
          indicator: candidate.indicator.id,
          dimensions: candidate.dimensions,
        })

        const verdict = judge(
          Option.match(current, { onNone: () => [], onSome: (found) => found.observations }),
          candidate.observations,
        )

        if (Verdict.$is("Hold")(verdict)) {
          yield* hold(candidate, verdict)

          return "Held" satisfies Outcome
        }

        yield* store.write(candidate)

        return "Stored" satisfies Outcome
      })

      const one = Effect.fn("Gather.one")(function* (entry: CatalogEntry, version: string) {
        const { indicator, name, definition } = entry

        // An indicator the World Bank no longer knows is an empty candidate.
        const answer = yield* worldBank
          .series(indicator)
          .pipe(
            Effect.catchTag("IndicatorNotFound", () =>
              Effect.map(DateTime.now, (retrievedAt) => ({ observations: [], retrievedAt })),
            ),
          )

        return yield* offer(
          {
            indicator: { id: indicator, name, definition },
            dataset: datasetOf(indicator, "World Development Indicators"),
            version,
            retrievedAt: answer.retrievedAt,
            observations: Arr.sort(answer.observations, byCountryYear),
          },
          yield* store.hash({ indicator }),
        )
      })

      const check = Effect.gen(function* () {
        const version = yield* worldBank.version
        const last = yield* gathered("World Bank")

        if (Option.exists(last, (found) => found.version === version)) return null

        if (Option.isNone(yield* published("World Bank"))) return yield* new CatalogUnavailable()

        return version
      }).pipe(
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
        Effect.withSpan("Gather.worldBank.check"),
      )

      const gather = Effect.fn("Gather.worldBank.gather")(
        function* ({ version, after }: { version: string; after: string }) {
          const entries = yield* listed(after)

          const outcomes = yield* Effect.forEach(
            entries,
            (entry) =>
              one(entry, version).pipe(
                Effect.tapError((error) =>
                  Effect.logWarning("Could not gather", entry.indicator, error),
                ),
                Effect.orElseSucceed((): Outcome => "Failed"),
              ),
            { concurrency: together },
          )

          // A series stored or matched again is no longer held back.
          const settled = entries.flatMap((entry, at) =>
            outcomes[at] === "Stored" || outcomes[at] === "Unchanged"
              ? [keyOf({ indicator: entry.indicator })]
              : [],
          )

          if (Arr.isArrayNonEmpty(settled)) {
            const keys = yield* Schema.encodeEffect(KeysJson)(settled)

            yield* sql`DELETE FROM series_held WHERE series IN (SELECT value FROM json_each(${keys}))`
          }

          const count = (outcome: Outcome) => outcomes.filter((found) => found === outcome).length

          return {
            after:
              Arr.isArrayNonEmpty(entries) && entries.length === perStep
                ? Arr.lastNonEmpty(entries).indicator
                : null,
            stored: count("Stored"),
            unchanged: count("Unchanged"),
            held: count("Held"),
            skipped: 0,
            failed: count("Failed"),
          } satisfies Gathered
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      const finish = Effect.fn("Gather.worldBank.finish")(
        function* (version: string) {
          yield* record("World Bank", version)
        },
        Effect.catchTag("SqlError", Effect.die),
      )

      const checkEurostat = Effect.gen(function* () {
        if (Option.isNone(yield* published("Eurostat"))) return 0

        const releases = yield* eurostat.releases
        const entries = yield* catalogued("Eurostat")

        const found = entries.flatMap(({ indicator }) => {
          const release = releases.get(indicator.split(",")[1] ?? "")

          return release === undefined ? [] : [{ scope: indicator, ...release }]
        })

        const rows = yield* Schema.encodeEffect(ReleasesJson)(found)

        yield* sql`
          INSERT INTO series_release (scope, version, size)
          SELECT value ->> 'scope', value ->> 'version', value ->> 'size' FROM json_each(${rows})
          WHERE true
          ON CONFLICT (scope) DO UPDATE SET version = excluded.version, size = excluded.size
        `

        const [waiting] = yield* sql<{ count: number }>`
          SELECT count(*) AS count FROM series_release AS release
          LEFT JOIN series_version AS done ON done.scope = release.scope
          WHERE done.version IS NULL OR done.version != release.version
        `

        return waiting?.count ?? 0
      }).pipe(
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
        Effect.withSpan("Gather.eurostat.check"),
      )

      const skip = (dataset: Pending, reason: Skip) =>
        Effect.logInfo("Skipped a Eurostat dataset", dataset.indicator, reason).pipe(
          Effect.andThen(sql`
            INSERT INTO series_skipped (scope, reason, version)
            VALUES (${dataset.indicator}, ${reason}, ${dataset.version})
            ON CONFLICT (scope) DO UPDATE SET reason = excluded.reason, version = excluded.version
          `),
        )

      // Offers each series of one dataset as its bulk file downloads, and
      // records the dataset's release once every series is offered or the
      // dataset is skipped. A dataset with a failed series keeps its release
      // unrecorded.
      const dataset = Effect.fn("Gather.eurostat.dataset")(function* (found: Pending) {
        const counts = { stored: 0, unchanged: 0, held: 0, skipped: 0, failed: 0 }
        const now = yield* DateTime.now

        const settle = isFinal(found.version, now)
          ? record(found.indicator, found.version)
          : Effect.void

        if (found.size > largest) {
          yield* skip(found, "TooLarge")
          yield* settle

          return { ...counts, skipped: 1 }
        }

        const hashes = yield* store.hashes(found.indicator)
        const heldKeys: Array<string> = []

        const candidate = ({ dimensions, observations }: Combination): Stored => ({
          indicator: { id: found.indicator, name: found.name, definition: found.definition },
          dataset: found.name,
          version: found.version,
          retrievedAt: now,
          dimensions,
          observations: Arr.sort(observations, byCountryYear),
        })

        const offered = yield* eurostat.series(found.indicator).pipe(
          Stream.mapEffect(
            (combination) => {
              const series = candidate(combination)
              const key = keyOf({ indicator: found.indicator, dimensions: combination.dimensions })

              return offer(series, Option.fromNullishOr(hashes.get(key))).pipe(
                Effect.tap((outcome) =>
                  Effect.sync(() => {
                    if (outcome === "Held") heldKeys.push(key)
                  }),
                ),
              )
            },
            { concurrency: writing },
          ),
          Stream.runForEach((outcome) =>
            Effect.sync(() => {
              if (outcome === "Stored") counts.stored += 1
              else if (outcome === "Unchanged") counts.unchanged += 1
              else if (outcome === "Held") counts.held += 1
            }),
          ),
          Effect.as(true),
          Effect.catchTags({
            Unstorable: ({ reason }) => skip(found, reason).pipe(Effect.as(false)),
            IndicatorNotFound: () => skip(found, "NotFound").pipe(Effect.as(false)),
          }),
        )

        if (offered) {
          // The dataset's series stored or matched again are no longer held
          // back; neither are series it no longer has.
          const keys = yield* Schema.encodeEffect(KeysJson)(heldKeys)
          const prefix = keyOf({ indicator: found.indicator, dimensions: {} })

          yield* sql`
            DELETE FROM series_held WHERE substr(series, 1, ${prefix.length}) = ${prefix}
              AND series NOT IN (SELECT value FROM json_each(${keys}))
          `
          yield* sql`DELETE FROM series_skipped WHERE scope = ${found.indicator}`
        }

        yield* settle

        return offered ? counts : { ...counts, skipped: 1 }
      })

      const gatherEurostat = Effect.fn("Gather.eurostat.gather")(
        function* (after: string) {
          const waiting = yield* pending(after)
          const batch = batchOf(waiting)
          const totals = { stored: 0, unchanged: 0, held: 0, skipped: 0, failed: 0 }

          for (const found of batch) {
            const counts = yield* dataset(found).pipe(
              Effect.catchTag("SqlError", Effect.die),
              Effect.tapError((error) =>
                Effect.logWarning("Could not gather", found.indicator, error),
              ),
              Effect.orElseSucceed(() => ({ ...none, failed: 1 })),
            )

            totals.stored += counts.stored
            totals.unchanged += counts.unchanged
            totals.held += counts.held
            totals.skipped += counts.skipped
            totals.failed += counts.failed
          }

          const more = batch.length < waiting.length || waiting.length === perStep

          return {
            ...totals,
            after: Arr.isArrayNonEmpty(batch) && more ? Arr.lastNonEmpty(batch).indicator : null,
          } satisfies Gathered
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      return Gather.of({
        worldBank: { check, gather, finish },
        eurostat: { check: checkEurostat, gather: gatherEurostat },
      })
    }).pipe(Effect.orDie),
  )

  // Inside Workers, where the Workflow runs: D1, the SERIES bucket, and the
  // sources asked directly, never through the cache or the store, paced
  // with a longer wait than a visitor's request.
  static readonly live = Gather.layer.pipe(
    Layer.provide(database),
    Layer.provide(Store.layer),
    Layer.provide(Layer.merge(WorldBank.layer, Eurostat.layer).pipe(Layer.provide(Pace.gathering))),
  )

  // Gathers the World Bank, then Eurostat, and fails once both are done if
  // either left series ungathered.
  static readonly run = Effect.fn("Gather.run")(function* () {
    const failed = [
      { source: "World Bank" as const, count: yield* runWorldBank() },
      { source: "Eurostat" as const, count: yield* runEurostat() },
    ].filter(({ count }) => count > 0)

    return yield* Arr.isArrayNonEmpty(failed)
      ? Effect.fail(
          new GatherFailed({
            sources: failed.map(({ source }) => source),
            failed: failed.reduce((total, { count }) => total + count, 0),
          }),
        )
      : Effect.void
  })
}

// Runs one source's gather steps from the start of its catalog, each step
// resuming after the indicator the previous one ended on, and answers the
// totals.
const steps = Effect.fn("Gather.steps")(function* (
  source: Source,
  gather: (after: string) => Effect.Effect<Gathered>,
  options: { readonly name: (after: string) => string; readonly timeout?: "30 minutes" },
) {
  const step = yield* Step
  const totals = { stored: 0, unchanged: 0, held: 0, skipped: 0, failed: 0 }
  let after: string | null = ""

  while (after !== null) {
    const batch: Gathered = yield* step.run(
      options.name(after),
      gather(after),
      options.timeout === undefined ? {} : { timeout: options.timeout },
    )

    totals.stored += batch.stored
    totals.unchanged += batch.unchanged
    totals.held += batch.held
    totals.skipped += batch.skipped
    totals.failed += batch.failed
    after = batch.after
  }

  yield* Effect.logInfo(`Gathered ${source}`, totals)

  return totals
})

// Checks the release, then gathers the catalog's indicators 50 a step, and
// records the release once every indicator is gathered or held back. A run
// that resumes after a failure replays the steps that completed. Answers
// how many indicators failed.
const runWorldBank = Effect.fn("Gather.runWorldBank")(function* () {
  const step = yield* Step
  const { worldBank } = yield* Gather

  const version = yield* step.run("check World Bank", worldBank.check)

  if (version === null) {
    yield* Effect.logInfo("No new World Bank release")

    return 0
  }

  const totals = yield* steps("World Bank", (after) => worldBank.gather({ version, after }), {
    name: (after) => `gather World Bank ${version} after ${after}`,
  })

  if (totals.failed === 0)
    yield* step.run(`finish World Bank ${version}`, worldBank.finish(version))

  return totals.failed
})

// Records each dataset's release, then gathers the datasets whose release
// moved. Each dataset records its own release, so a run that fails part way
// leaves only the datasets it did not gather for the next run. Answers how
// many datasets failed.
const runEurostat = Effect.fn("Gather.runEurostat")(function* () {
  const step = yield* Step
  const { eurostat } = yield* Gather

  const waiting = yield* step.run("check Eurostat", eurostat.check)

  if (waiting === 0) {
    yield* Effect.logInfo("No new Eurostat release")

    return 0
  }

  const totals = yield* steps("Eurostat", eurostat.gather, {
    name: (after) => `gather Eurostat after ${after}`,
    // A large dataset stores up to 50,000 series.
    timeout: "30 minutes",
  })

  return totals.failed
})
