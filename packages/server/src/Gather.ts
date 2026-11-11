import {
  CatalogUnavailable,
  type CatalogEntry,
  IndicatorId,
  pathOf,
  Source,
  type SourceUnavailable,
} from "@civicdata/domain"
import {
  Array as Arr,
  Context,
  Data,
  DateTime,
  Effect,
  Layer,
  Option,
  Schema,
  Stream,
} from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { Policy } from "./Adapter.ts"
import { tables } from "./Catalog.ts"
import { database, Step } from "./CatalogBuild.ts"
import { Pace } from "./Pace.ts"
import { Sdmx } from "./Sdmx.ts"
import { Sources } from "./Sources.ts"
import { keyOf, Outcome, type Place, type Stored, Store } from "./Store.ts"
import { WorldBank } from "./WorldBank.ts"

// Catalog entries per step. The World Bank's bulk download of one is a ZIP
// of about 50 KB, served in a tenth of a second, so 50 asked two at a time
// take the half minute the 120-a-minute budget allows.
const perStep = 50

const together = 2

// What a step saves: the last entry it gathered, null once the catalog is
// done, and how many series were stored, unchanged (the stored series
// already holds the same values), held back, or failed (the source or the
// store did not answer; a failed entry counts once).
type Gathered = {
  readonly after: string | null
  readonly stored: number
  readonly unchanged: number
  readonly held: number
  readonly failed: number
}

// A source whose policy stores every catalog entry it lists.
interface Mirror {
  readonly source: Source
  readonly policy: Data.TaggedEnum.Value<Policy, "Full">
}

interface Interface {
  // The sources the gather stores, in the order a run gathers them.
  readonly mirrors: ReadonlyArray<Mirror>
  // The source's release to gather, or null when the last complete run
  // gathered it. It fails while the catalog has no entries of the source,
  // since a run gathers what the catalog lists: recording the release then
  // would store nothing until the next one.
  readonly check: (
    mirror: Mirror,
  ) => Effect.Effect<string | null, SourceUnavailable | CatalogUnavailable>
  // Gathers the series of the source's catalog entries after `after`, in
  // code order, and answers what it did.
  readonly gather: (
    mirror: Mirror,
    options: { version: string; after: string },
  ) => Effect.Effect<Gathered>
  // Records the release as gathered, so the next run with the same one stops
  // after its check.
  readonly finish: (mirror: Mirror, version: string) => Effect.Effect<void>
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

// Gathers into the store the series of every source whose policy is Full: on
// a schedule, it asks the source what changed, gathers every series of each
// catalog entry it lists, and stores each, unless the stored one already
// holds the same values or the candidate would lose some of them (the
// hold-back rule in Store.ts). It is the only writer to the store.
export class Gather extends Context.Service<Gather, Interface>()("@civicdata/server/Gather") {
  static readonly layer = Layer.effect(
    Gather,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const store = yield* Store
      const sources = yield* Sources

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

      const gathered = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Schema.Struct({ version: Schema.String }),
        execute: (scope) => sql`SELECT version FROM series_version WHERE scope = ${scope}`,
      })

      // The catalog's published entries of a source after `after`, in code
      // order. The catalog is an FTS5 table, so the order is a sort of the
      // source's rows: for the World Bank's 1,500, cheap next to one request.
      const listed = SqlSchema.findAll({
        Request: Schema.Struct({ source: Source, after: Schema.String }),
        Result: Schema.Struct({
          indicator: IndicatorId,
          name: Schema.NonEmptyString,
          definition: Schema.String,
        }),
        execute: ({ source, after }) => sql`
          SELECT catalog.indicator, catalog.name, catalog.definition FROM catalog
          JOIN catalog_current AS current
            ON current.source = catalog.source AND current.generation = catalog.generation
          WHERE catalog.source = ${source} AND catalog.indicator > ${after}
          ORDER BY catalog.indicator
          LIMIT ${perStep}
        `,
      })

      const published = SqlSchema.findOneOption({
        Request: Source,
        Result: Schema.Struct({ generation: Schema.Int }),
        execute: (source) => sql`SELECT generation FROM catalog_current WHERE source = ${source}`,
      })

      // The series of an indicator held back, named by `pathOf` their key.
      const heldIn = SqlSchema.findAll({
        Request: IndicatorId,
        Result: Schema.Struct({ series: Schema.String }),
        execute: (indicator) => sql`
          SELECT series FROM series_held
          WHERE series = ${indicator} OR substr(series, 1, ${indicator.length + 1}) = ${`${indicator}/`}
        `,
      })

      const hold = Effect.fn("Gather.hold")(function* (
        candidate: Stored,
        { reason, lost }: { reason: "Empty" | "Lost"; lost: ReadonlyArray<Place> },
      ) {
        const places = yield* Schema.encodeEffect(PlacesJson)(lost)
        const at = DateTime.formatIso(candidate.retrievedAt)
        const series = pathOf(keyOf(candidate))

        yield* Effect.logWarning("Held back a series", series, reason, lost.length)
        yield* sql`
          INSERT INTO series_held (series, reason, lost, version, retrieved_at)
          VALUES (${series}, ${reason}, ${places}, ${candidate.version}, ${at})
          ON CONFLICT (series) DO UPDATE SET reason = excluded.reason, lost = excluded.lost,
            version = excluded.version, retrieved_at = excluded.retrieved_at
        `
      })

      // Offers every series of the entry to the store as the source sends
      // them, records each one held back, and clears the ones stored or
      // matched again. Answers how many had each outcome.
      const one = Effect.fn("Gather.one")(function* (
        { policy }: Mirror,
        { entry, version }: { entry: CatalogEntry; version: string },
      ) {
        const held = new Set((yield* heldIn(entry.indicator)).map(({ series }) => series))
        const settled: Array<string> = []
        const counts = { stored: 0, unchanged: 0, held: 0 }

        const settle = (candidate: Stored) => {
          const series = pathOf(keyOf(candidate))

          if (held.has(series)) settled.push(series)
        }

        yield* store.write(entry.indicator, policy.gather(entry, version)).pipe(
          Stream.runForEach(({ candidate, outcome }) =>
            Outcome.$match(outcome, {
              Stored: () => Effect.sync(() => ((counts.stored += 1), settle(candidate))),
              Unchanged: () => Effect.sync(() => ((counts.unchanged += 1), settle(candidate))),
              Held: (verdict) =>
                Effect.sync(() => (counts.held += 1)).pipe(
                  Effect.andThen(hold(candidate, verdict)),
                ),
            }),
          ),
        )

        // A series stored or matched again is no longer held back.
        if (Arr.isArrayNonEmpty(settled)) {
          const keys = yield* Schema.encodeEffect(KeysJson)(settled)

          yield* sql`DELETE FROM series_held WHERE series IN (SELECT value FROM json_each(${keys}))`
        }

        return counts
      })

      const check = Effect.fn("Gather.check")(
        function* ({ source, policy }: Mirror) {
          const last = yield* gathered(source)
          const version = yield* policy.changed(Option.map(last, (found) => found.version))

          if (Option.isNone(version)) return null

          if (Option.isNone(yield* published(source))) return yield* new CatalogUnavailable()

          return version.value
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      const gather = Effect.fn("Gather.gather")(
        function* (mirror: Mirror, { version, after }: { version: string; after: string }) {
          const entries = yield* listed({ source: mirror.source, after })

          const results = yield* Effect.forEach(
            entries,
            (entry) =>
              one(mirror, { entry, version }).pipe(
                Effect.map((counts) => ({ ...counts, failed: 0 })),
                Effect.tapError((error) =>
                  Effect.logWarning("Could not gather", entry.indicator, error),
                ),
                Effect.orElseSucceed(() => ({ stored: 0, unchanged: 0, held: 0, failed: 1 })),
              ),
            { concurrency: together },
          )

          const count = (outcome: "stored" | "unchanged" | "held" | "failed") =>
            results.reduce((total, counts) => total + counts[outcome], 0)

          return {
            after:
              Arr.isArrayNonEmpty(entries) && entries.length === perStep
                ? Arr.lastNonEmpty(entries).indicator
                : null,
            stored: count("stored"),
            unchanged: count("unchanged"),
            held: count("held"),
            failed: count("failed"),
          } satisfies Gathered
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      const finish = Effect.fn("Gather.finish")(
        function* ({ source }: Mirror, version: string) {
          yield* sql`
            INSERT INTO series_version (scope, version) VALUES (${source}, ${version})
            ON CONFLICT (scope) DO UPDATE SET version = excluded.version
          `
        },
        Effect.catchTag("SqlError", Effect.die),
      )

      const mirrors = Source.literals.flatMap((source): ReadonlyArray<Mirror> => {
        const { policy } = sources[source]

        return Policy.$is("Full")(policy) ? [{ source, policy }] : []
      })

      return Gather.of({ mirrors, check, gather, finish })
    }).pipe(Effect.orDie),
  )

  // Inside Workers, where the Workflow runs: D1, the SERIES bucket, and each
  // source asked directly, never through the cache or the store, paced with
  // a longer wait than a visitor's request.
  static readonly live = Gather.layer.pipe(
    Layer.provide(database),
    Layer.provide(Store.layer),
    Layer.provide(Sources.layer),
    Layer.provide(Layer.merge(WorldBank.layer, Sdmx.layer).pipe(Layer.provide(Pace.gathering))),
  )

  // Gathers each mirrored source in turn: checks its release, then gathers
  // its catalog entries 50 a step, each step resuming after the last entry
  // the previous one gathered, and records the release once every series is
  // gathered or held back. A run that resumes after a failure replays the
  // steps that completed. A source with series that failed fails the run.
  static readonly run = Effect.fn("Gather.run")(function* () {
    const gather = yield* Gather

    for (const mirror of gather.mirrors) yield* mirrorOne(mirror)
  })
}

const mirrorOne = Effect.fn("Gather.mirror")(function* (mirror: Mirror) {
  const step = yield* Step
  const gather = yield* Gather
  const { source } = mirror

  const version = yield* step.run(`check ${source}`, gather.check(mirror))

  if (version === null) return yield* Effect.logInfo(`No new ${source} release`)

  const totals = { stored: 0, unchanged: 0, held: 0, failed: 0 }
  let after: string | null = ""

  while (after !== null) {
    const batch: Gathered = yield* step.run(
      `gather ${source} ${version} after ${after}`,
      gather.gather(mirror, { version, after }),
    )

    totals.stored += batch.stored
    totals.unchanged += batch.unchanged
    totals.held += batch.held
    totals.failed += batch.failed
    after = batch.after
  }

  yield* Effect.logInfo(`Gathered ${source}`, version, totals)

  if (totals.failed > 0) return yield* new GatherFailed({ source, failed: totals.failed })

  return yield* step.run(`finish ${source} ${version}`, gather.finish(mirror, version))
})
