import {
  CatalogUnavailable,
  type CatalogEntry,
  countries,
  IndicatorId,
  type Source,
  SourceUnavailable,
  Year,
} from "@civicdata/domain"
import { Array as Arr, Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { tables } from "./Catalog.ts"
import { database, Step } from "./CatalogBuild.ts"
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

// Indicators per step. The World Bank answers one in about a second with
// about 3 MB for every country and year, so 50 asked two at a time take
// about half a minute, within the 120-a-minute budget, and hold at most two
// answers in memory.
const perStep = 50

const together = 2

// What happened to each indicator a step gathered: stored, unchanged (the
// stored series already holds the same values), held back, or failed (the
// source or the store did not answer).
const Outcome = Schema.Literals(["Stored", "Unchanged", "Held", "Failed"])

type Outcome = typeof Outcome.Type

// What a step saves: the last indicator it gathered, null once the catalog is
// done, and how many indicators had each outcome.
type Gathered = {
  readonly after: string | null
  readonly stored: number
  readonly unchanged: number
  readonly held: number
  readonly failed: number
}

interface Interface {
  // The World Development Indicators' release to gather, or null when the
  // last complete run gathered it. It fails while the catalog has no World
  // Bank entries, since a run gathers what the catalog lists: on a new stage,
  // the catalog build started with it has not published yet.
  readonly check: Effect.Effect<string | null, SourceUnavailable | CatalogUnavailable>
  // Gathers the series of the catalog's World Bank indicators after `after`,
  // in code order, and answers what it did.
  readonly gather: (options: { version: string; after: string }) => Effect.Effect<Gathered>
  // Records the release as gathered, so the next run with the same one stops
  // after its check.
  readonly finish: (version: string) => Effect.Effect<void>
}

// A run that could not gather some series: the release is not recorded, so
// the next run asks for every indicator again.
export class GatherFailed extends Schema.TaggedError<
  GatherFailed,
  { readonly brand: unique symbol }
>()("GatherFailed", { source: Schema.String, failed: Schema.Int }) {}

const PlacesJson = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ country: Schema.String, year: Schema.Int })),
)

const KeysJson = Schema.fromJsonString(Schema.Array(Schema.String))

// Every country we chart: asking for them by code leaves out the World
// Bank's regions and income groups, which no chart shows.
const everyCountry = countries.map((country) => country.code)

const first = Year.make(1960)

// Gathers each source's series into the store: on a schedule, it asks a
// source for every country and year of each indicator in the catalog and
// stores each as one series, unless the stored one already holds the same
// values or the candidate would lose some of them (the hold-back rule in
// Store.ts). Eurostat and the OECD will add their own check and gather steps
// beside the World Bank's, sharing the store, the rule and the tables.
export class Gather extends Context.Service<Gather, Interface>()("@civicdata/server/Gather") {
  static readonly layer = Layer.effect(
    Gather,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const store = yield* Store
      const worldBank = yield* WorldBank

      // The catalog's, which a new stage's first run may read before the
      // first catalog build has made them.
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

      const published = SqlSchema.findOneOption({
        Request: Schema.Void,
        Result: Schema.Struct({ generation: Schema.Int }),
        execute: () =>
          sql`SELECT generation FROM catalog_current WHERE source = ${"World Bank" satisfies Source}`,
      })

      const hold = Effect.fn("Gather.hold")(function* (
        candidate: Stored,
        { reason, lost }: { reason: "Empty" | "Lost"; lost: ReadonlyArray<Place> },
      ) {
        const places = yield* Schema.encodeEffect(PlacesJson)(lost)
        const at = DateTime.formatIso(candidate.retrievedAt)

        yield* Effect.logWarning("Held back a series", candidate.indicator.id, reason, lost.length)
        yield* sql`
          INSERT INTO series_held (series, reason, lost, version, retrieved_at)
          VALUES (${keyOf(candidate.indicator.id)}, ${reason}, ${places}, ${candidate.version}, ${at})
          ON CONFLICT (series) DO UPDATE SET reason = excluded.reason, lost = excluded.lost,
            version = excluded.version, retrieved_at = excluded.retrieved_at
        `
      })

      // Stores the candidate unless the stored series holds the same values
      // (compared by hash, so only a changed series is read) or the hold-back
      // rule keeps the stored one.
      const offer = Effect.fn("Gather.offer")(function* (candidate: Stored) {
        const id = candidate.indicator.id
        const hash = yield* hashOf(candidate)

        if (Option.exists(yield* store.hash(id), (stored) => stored === hash)) {
          return "Unchanged" satisfies Outcome
        }

        const stored = yield* store.read(id)

        const verdict = judge(
          Option.match(stored, { onNone: () => [], onSome: (found) => found.observations }),
          candidate.observations,
        )

        if (Verdict.$is("Hold")(verdict)) {
          yield* hold(candidate, verdict)

          return "Held" satisfies Outcome
        }

        yield* store.write(candidate)

        return "Stored" satisfies Outcome
      })

      const one = Effect.fn("Gather.one")(function* (
        entry: CatalogEntry,
        { version, to }: { version: string; to: Year },
      ) {
        const { indicator, name, definition } = entry

        // An indicator the World Bank no longer knows is an empty candidate.
        const answer = yield* worldBank
          .observations({ indicator, countries: everyCountry, from: first, to })
          .pipe(
            Effect.catchTag("IndicatorNotFound", () =>
              Effect.map(DateTime.now, (retrievedAt) => ({ observations: [], retrievedAt })),
            ),
          )

        return yield* offer({
          indicator: { id: indicator, name, definition },
          dataset: datasetOf(indicator, "World Development Indicators"),
          version,
          retrievedAt: answer.retrievedAt,
          observations: Arr.sort(answer.observations, byCountryYear),
        })
      })

      const check = Effect.gen(function* () {
        const version = yield* worldBank.version
        const last = yield* gathered("World Bank")

        if (Option.exists(last, (found) => found.version === version)) return null

        if (Option.isNone(yield* published())) return yield* new CatalogUnavailable()

        return version
      }).pipe(
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
        Effect.withSpan("Gather.check"),
      )

      const gather = Effect.fn("Gather.gather")(
        function* ({ version, after }: { version: string; after: string }) {
          const entries = yield* listed(after)
          const now = yield* DateTime.now
          const to = Year.make(DateTime.getPartUtc(now, "year"))

          const outcomes = yield* Effect.forEach(
            entries,
            (entry) =>
              one(entry, { version, to }).pipe(
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
              ? [keyOf(entry.indicator)]
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
            failed: count("Failed"),
          } satisfies Gathered
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      const finish = Effect.fn("Gather.finish")(
        function* (version: string) {
          yield* sql`
            INSERT INTO series_version (scope, version) VALUES (${"World Bank" satisfies Source}, ${version})
            ON CONFLICT (scope) DO UPDATE SET version = excluded.version
          `
        },
        Effect.catchTag("SqlError", Effect.die),
      )

      return Gather.of({ check, gather, finish })
    }).pipe(Effect.orDie),
  )

  // Inside Workers, where the Workflow runs: D1, the SERIES bucket, and the
  // World Bank asked directly, never through the cache or the store, paced
  // with a longer wait than a visitor's request.
  static readonly live = Gather.layer.pipe(
    Layer.provide(database),
    Layer.provide(Store.layer),
    Layer.provide(WorldBank.layer.pipe(Layer.provide(Pace.gathering))),
  )

  // Checks the release, then gathers the catalog's indicators 50 a step, each
  // step resuming after the last indicator the previous one gathered, and
  // records the release once every indicator is gathered or held back. A run
  // that resumes after a failure replays the steps that completed.
  static readonly run = Effect.fn("Gather.run")(function* () {
    const step = yield* Step
    const gather = yield* Gather

    const version = yield* step.run("check World Bank", gather.check)

    if (version === null) return yield* Effect.logInfo("No new World Bank release")

    const totals = { stored: 0, unchanged: 0, held: 0, failed: 0 }
    let after: string | null = ""

    while (after !== null) {
      const batch: Gathered = yield* step.run(
        `gather World Bank ${version} after ${after}`,
        gather.gather({ version, after }),
      )

      totals.stored += batch.stored
      totals.unchanged += batch.unchanged
      totals.held += batch.held
      totals.failed += batch.failed
      after = batch.after
    }

    yield* Effect.logInfo("Gathered the World Bank", version, totals)

    if (totals.failed > 0) {
      return yield* new GatherFailed({ source: "World Bank", failed: totals.failed })
    }

    return yield* step.run(`finish World Bank ${version}`, gather.finish(version))
  })
}
