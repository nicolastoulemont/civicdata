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
  Result,
  Schema,
  Stream,
} from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { Policy, Versions } from "./Adapter.ts"
import { tables } from "./Catalog.ts"
import { database, Step } from "./CatalogBuild.ts"
import { ledger } from "./GatherLedger.ts"
import { Pace } from "./Pace.ts"
import { Sdmx } from "./Sdmx.ts"
import { Sources } from "./Sources.ts"
import { keyOf, Outcome, type Place, type Stored, Store } from "./Store.ts"
import { WorldBank } from "./WorldBank.ts"

// Catalog entries per step. The World Bank's bulk download of one is a ZIP
// of about 50 KB, served in a tenth of a second. Pace keeps requests within
// the source's budget.
const perStep = 50

// What a step saves: the last entry it gathered, null once the catalog is
// done, and how many entries were stored, unchanged (the stored series
// already holds the same values), held back, or failed (the source or the
// store did not answer; a failed entry counts once).
type Batch = {
  readonly streak: number
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
  readonly check: (
    mirror: Mirror,
  ) => Effect.Effect<Versions, SourceUnavailable | CatalogUnavailable>
  readonly gather: (
    mirror: Mirror,
    options: { versions: Versions; after: string; streak: number },
  ) => Effect.Effect<Batch>
}

// Five consecutive entry failures stop a source while keeping its ledger.
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

      const records = yield* ledger

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

      const listed = SqlSchema.findAll({
        Request: Source,
        Result: Schema.Struct({
          indicator: IndicatorId,
          name: Schema.NonEmptyString,
          definition: Schema.String,
        }),
        execute: (source) => sql`
          SELECT catalog.indicator, catalog.name, catalog.definition FROM catalog
          JOIN catalog_current AS current
            ON current.source = catalog.source AND current.generation = catalog.generation
          WHERE catalog.source = ${source} ORDER BY catalog.indicator`,
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

        // Counts a series stored or matched again, which is no longer held
        // back.
        const settle = (candidate: Stored, outcome: "stored" | "unchanged") =>
          Effect.sync(() => {
            const series = pathOf(keyOf(candidate))

            counts[outcome] += 1

            if (held.has(series)) settled.push(series)
          })

        yield* store.write(entry.indicator, policy.gather(entry, version)).pipe(
          Stream.runForEach(({ candidate, outcome }) =>
            Outcome.$match(outcome, {
              Stored: () => settle(candidate, "stored"),
              Unchanged: () => settle(candidate, "unchanged"),
              Held: (verdict) =>
                Effect.sync(() => (counts.held += 1)).pipe(
                  Effect.andThen(hold(candidate, verdict)),
                ),
            }),
          ),
        )

        if (Arr.isArrayNonEmpty(settled)) {
          const keys = yield* Schema.encodeEffect(KeysJson)(settled)

          yield* sql`DELETE FROM series_held WHERE series IN (SELECT value FROM json_each(${keys}))`
        }

        return counts
      })

      const check = Effect.fn("Gather.check")(
        function* ({ source, policy }: Mirror) {
          if (Option.isNone(yield* published(source))) return yield* new CatalogUnavailable()

          const versions = yield* policy.changed(yield* listed(source))

          const counts = yield* records.summary({
            source,
            versions,
            now: DateTime.formatIso(yield* DateTime.now),
          })

          yield* Effect.logInfo(`Checked ${source}`, counts)

          return versions
        },
        Effect.catchTags({
          SqlError: Effect.die,
          SchemaError: Effect.die,
          NoSuchElementError: Effect.die,
        }),
      )

      const gather = Effect.fn("Gather.gather")(
        function* (
          mirror: Mirror,
          { versions, after, streak }: { versions: Versions; after: string; streak: number },
        ) {
          const entries = yield* records.work({
            source: mirror.source,
            versions,
            after,
            now: DateTime.formatIso(yield* DateTime.now),
          })

          const totals = { stored: 0, unchanged: 0, held: 0, failed: 0 }
          let consecutive = streak
          let cursor: string | null = null

          // Sequential requests stop exactly at the fifth failure. A cursor
          // prevents an isolated failure from reappearing in this run.
          for (const { version, state, ...entry } of entries) {
            const result = yield* one(mirror, { entry, version }).pipe(Effect.result)

            if (Result.isSuccess(result)) {
              yield* records.stored(entry.indicator, { source: mirror.source, version })

              if (result.success.held > 0) totals.held += 1
              else if (result.success.stored > 0) totals.stored += 1
              else totals.unchanged += 1
              consecutive = 0
            } else {
              yield* records.failed(entry.indicator, {
                source: mirror.source,
                version,
                previous: state,
                reason: String(result.failure),
              })
              totals.failed += 1
              consecutive += 1
            }

            cursor = entry.indicator

            if (consecutive === 5) break
          }

          return {
            ...totals,
            streak: consecutive,
            after: entries.length === perStep || consecutive === 5 ? cursor : null,
          } satisfies Batch
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      const mirrors = Source.literals.flatMap((source): ReadonlyArray<Mirror> => {
        const { policy } = sources[source]

        return Policy.$is("Full")(policy) ? [{ source, policy }] : []
      })

      return Gather.of({ mirrors, check, gather })
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

  // Workflow steps save cursors and failure streaks; the ledger survives runs.
  static readonly run = Effect.fn("Gather.run")(function* () {
    const gather = yield* Gather

    for (const mirror of gather.mirrors) yield* mirrorOne(mirror)
  })
}

const mirrorOne = Effect.fn("Gather.mirror")(function* (mirror: Mirror) {
  const step = yield* Step
  const gather = yield* Gather
  const { source } = mirror

  const saved = yield* step.run(
    `check ${source}`,
    gather.check(mirror).pipe(Effect.flatMap(Schema.encodeEffect(Schema.fromJsonString(Versions)))),
  )

  const versions = yield* Schema.decodeEffect(Schema.fromJsonString(Versions))(saved).pipe(
    Effect.orDie,
  )

  const totals = { stored: 0, unchanged: 0, held: 0, failed: 0 }
  let after: string | null = ""
  let streak = 0

  while (after !== null) {
    const batch: Batch = yield* step.run(
      `gather ${source} after ${after}`,
      gather.gather(mirror, { versions, after, streak }),
    )

    totals.stored += batch.stored
    totals.unchanged += batch.unchanged
    totals.held += batch.held
    totals.failed += batch.failed
    after = batch.after
    streak = batch.streak

    if (streak === 5) break
  }

  yield* Effect.logInfo(`Gathered ${source}`, totals)

  if (streak === 5) return yield* new GatherFailed({ source, failed: totals.failed })

  return undefined
})
