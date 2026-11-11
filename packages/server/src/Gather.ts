import {
  CatalogUnavailable,
  type CatalogEntry,
  type SeriesKey,
  sourceOf,
  SourceUnavailable,
  IndicatorId,
  pathOf,
  Source,
} from "@openfacts/domain"
import {
  Array as Arr,
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Predicate,
  Result,
  Schema,
  Stream,
} from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { AssetId, type Bulk, Release, Versions } from "./Adapter.ts"
import { tables } from "./Catalog.ts"
import { database, Step } from "./CatalogBuild.ts"
import { Faostat } from "./Faostat.ts"
import { ledger } from "./GatherLedger.ts"
import { Ilostat } from "./Ilostat.ts"
import { Insee } from "./Insee.ts"
import { Pace } from "./Pace.ts"
import { Releases, releaseTables } from "./Releases.ts"
import { Sdmx } from "./Sdmx.ts"
import { Sources } from "./Sources.ts"
import { judge, keyOf, Outcome, type Place, Stored, Store } from "./Store.ts"
import { Vdem } from "./Vdem.ts"
import { Who } from "./Who.ts"
import { Wid } from "./Wid.ts"
import { WorldBank } from "./WorldBank.ts"

// Assets per step. The World Bank's bulk download of one is a ZIP
// of about 50 KB, served in a tenth of a second. Pace keeps requests within
// the source's budget.
const perStep = 50

const verify = (bulk: Bulk, version: string) => bulk.verify?.(version) ?? Effect.void

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

// A source with selected download units.
interface Mirror {
  readonly source: Source
  readonly bulk: Bulk
}

interface Interface {
  // The sources the gather stores, in the order a run gathers them.
  readonly publish: (mirror: Mirror) => Effect.Effect<void, SourceUnavailable, Step>
  readonly mirrors: ReadonlyArray<Mirror>
  readonly check: (
    mirror: Mirror,
  ) => Effect.Effect<Versions, SourceUnavailable | CatalogUnavailable>
  readonly gather: (
    mirror: Mirror,
    options: { versions: Versions; after: string; streak: number },
  ) => Effect.Effect<Batch>
}

// Five consecutive asset failures stop a source while keeping its ledger.
export class GatherFailed extends Schema.TaggedError<
  GatherFailed,
  { readonly brand: unique symbol }
>()("GatherFailed", { source: Schema.String, failed: Schema.Int }) {}

const PlacesJson = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ country: Schema.String, year: Schema.Int })),
)

const KeysJson = Schema.fromJsonString(Schema.Array(Schema.String))

// Consumes each selected asset once and records progress only after all its
// entries have been persisted. Workflows and local runners supply the same
// services, with different Step layers. Store owns hashing and hold-back.
export class Gather extends Context.Service<Gather, Interface>()("@openfacts/server/Gather") {
  static readonly layer = Layer.effect(
    Gather,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const store = yield* Store
      const sources = yield* Sources

      // The catalog's, which a run may read before any catalog build has
      // made them.
      yield* tables

      const records = yield* ledger()
      const releases = yield* Releases.pipe(Effect.provide(Releases.layer))

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
        { source, bulk }: Mirror,
        {
          asset,
          version,
          entries,
          target = store,
          baseline,
          members,
        }: {
          asset: AssetId
          version: string
          entries: ReadonlyArray<CatalogEntry>
          target?: Store["Service"]
          baseline?: Store["Service"] | undefined
          members?: ReadonlyArray<SeriesKey>
        },
      ) {
        let previous = ""
        let emitted = false
        const totals = { stored: 0, unchanged: 0, held: 0 }
        const seen = new Set<string>()
        const expected = members === undefined ? undefined : new Set(members.map(pathOf))
        const allowed = new Set(entries.map(({ indicator }) => indicator))
        yield* bulk.gather(asset, { version, entries }).pipe(
          Stream.runForEach(({ indicator, series: candidatesStream }) =>
            Effect.gen(function* () {
              if (
                sourceOf(indicator) !== source ||
                !allowed.has(indicator) ||
                indicator <= previous
              ) {
                return yield* new SourceUnavailable({ source })
              }

              previous = indicator
              emitted = true
              const entry = { indicator }
              const held = new Set((yield* heldIn(entry.indicator)).map(({ series }) => series))
              const settled: Array<string> = []
              const counts = { stored: 0, unchanged: 0, held: 0 }
              let candidates = 0

              // Counts a series stored or matched again, which is no longer held
              // back.
              const settle = (candidate: Stored, outcome: "stored" | "unchanged") =>
                Effect.sync(() => {
                  const series = pathOf(keyOf(candidate))

                  counts[outcome] += 1

                  if (held.has(series)) settled.push(series)
                })

              yield* target
                .write(
                  entry.indicator,
                  candidatesStream.pipe(
                    Stream.mapEffect((candidate) => {
                      candidates += 1

                      return Schema.decodeEffect(Stored)(candidate).pipe(
                        Effect.mapError(() => new SourceUnavailable({ source })),
                        Effect.filterOrFail(
                          (decoded) =>
                            decoded.indicator.id === indicator && decoded.version === version,
                          () => new SourceUnavailable({ source }),
                        ),
                        Effect.tap((decoded) =>
                          Effect.gen(function* () {
                            const key = pathOf(keyOf(decoded))

                            if (expected !== undefined && (!expected.has(key) || seen.has(key)))
                              return yield* new SourceUnavailable({ source })
                            seen.add(key)

                            if (baseline !== undefined) {
                              const prior = yield* baseline.read(keyOf(decoded))

                              const verdict = judge(
                                Option.isSome(prior) ? prior.value.observations : [],
                                decoded.observations,
                              )

                              if (Predicate.isTagged(verdict, "Hold")) {
                                yield* hold(decoded, verdict)

                                return yield* new SourceUnavailable({ source })
                              }
                            }

                            return undefined
                          }),
                        ),
                      )
                    }),
                  ),
                )
                .pipe(
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

              if (candidates === 0) return yield* new SourceUnavailable({ source })

              if (Arr.isArrayNonEmpty(settled)) {
                const keys = yield* Schema.encodeEffect(KeysJson)(settled)

                yield* sql`DELETE FROM series_held WHERE series IN (SELECT value FROM json_each(${keys}))`
              }

              totals.stored += counts.stored
              totals.unchanged += counts.unchanged
              totals.held += counts.held

              return undefined
            }),
          ),
        )

        if (
          !emitted ||
          (expected !== undefined && (seen.size !== expected.size || totals.held > 0))
        )
          return yield* new SourceUnavailable({ source })

        return totals
      })

      const publish = Effect.fn("Gather.publish")(function* (mirror: Mirror) {
        const step = yield* Step
        const { source, bulk } = mirror

        if (bulk.release === undefined) return undefined
        yield* releaseTables.pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.mapError(() => new SourceUnavailable({ source })),
        )

        const catalog = yield* listed(source).pipe(
          Effect.mapError(() => new SourceUnavailable({ source })),
        )

        const saved = yield* step
          .run(
            `release ${source}`,
            bulk
              .release(catalog)
              .pipe(Effect.flatMap(Schema.encodeEffect(Schema.fromJsonString(Release)))),
          )
          .pipe(Effect.mapError(() => new SourceUnavailable({ source })))

        const release = yield* Schema.decodeEffect(Schema.fromJsonString(Release))(saved).pipe(
          Effect.mapError(() => new SourceUnavailable({ source })),
        )

        const prepared = yield* releases.prepare(source, release)

        if (Option.isNone(prepared)) return undefined
        const manifest = prepared.value
        const baseline = manifest.base === null ? undefined : store.namespace(manifest.base)
        const target = store.namespace(manifest.namespace)

        const staged = yield* ledger(`/${manifest.namespace}`).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.mapError(() => new SourceUnavailable({ source })),
        )

        const now = DateTime.formatIso(yield* DateTime.now)

        const stage = Effect.fn("Gather.stage")(function* (
          asset: AssetId,
          members: ReadonlyArray<SeriesKey>,
        ) {
          const versions = [{ asset, version: release.version }]

          const done = yield* staged
            .summary({ source, versions, now })
            .pipe(Effect.mapError(() => new SourceUnavailable({ source })))

          if (done.unchanged === 1) return Option.none()

          const [wanted] = yield* staged
            .work({ source, versions, after: "", now })
            .pipe(Effect.mapError(() => new SourceUnavailable({ source })))

          if (wanted === undefined) return Option.none()

          const attempt = yield* step
            .run(
              `stage ${source} ${manifest.namespace} ${asset}`,
              Effect.gen(function* () {
                const result = yield* one(mirror, {
                  asset,
                  version: release.version,
                  entries: catalog,
                  target,
                  baseline,
                  members,
                })

                if (result.held > 0) return yield* new SourceUnavailable({ source })
                yield* staged.stored(asset, { source, version: release.version })

                return undefined
              }),
            )
            .pipe(
              Effect.tapError((error) =>
                Effect.gen(function* () {
                  const completed = yield* staged.summary({ source, versions, now })

                  if (completed.unchanged === 0) {
                    yield* staged.failed(asset, {
                      source,
                      version: release.version,
                      previous: wanted.state,
                      reason: String(error.cause),
                    })
                  }
                }),
              ),
              Effect.mapError(() => new SourceUnavailable({ source })),
              Effect.result,
            )

          return Option.some(attempt)
        })

        let consecutive = 0

        for (const { asset, members } of release.assets) {
          const attempt = yield* stage(asset, members)

          if (Option.isNone(attempt)) continue
          consecutive = Result.isFailure(attempt.value) ? consecutive + 1 : 0

          if (consecutive === 5) break
        }

        // Every required asset has a completion record written only after its
        // exact membership persisted. No bucket-content inference is used.
        const versions = release.assets.map(({ asset }) => ({ asset, version: release.version }))

        const done = yield* staged
          .summary({ source, versions, now })
          .pipe(Effect.mapError(() => new SourceUnavailable({ source })))

        if (done.unchanged !== versions.length) return yield* new SourceUnavailable({ source })

        yield* verify(bulk, release.version)
        yield* step
          .run(`activate ${source} ${manifest.namespace}`, releases.activate(source, manifest))
          .pipe(Effect.mapError(() => new SourceUnavailable({ source })))

        return undefined
      })

      const check = Effect.fn("Gather.check")(
        function* ({ source, bulk }: Mirror) {
          if (Option.isNone(yield* published(source))) return yield* new CatalogUnavailable()

          if (bulk.changed === undefined) return yield* new SourceUnavailable({ source })

          const versions = yield* bulk.changed(yield* listed(source)).pipe(
            Effect.flatMap(Schema.decodeEffect(Versions)),
            Effect.mapError(() => new SourceUnavailable({ source })),
          )

          if (new Set(versions.map(({ asset }) => asset)).size !== versions.length) {
            return yield* new SourceUnavailable({ source })
          }

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
          const catalog = yield* listed(mirror.source)

          for (const { version, state, asset } of entries) {
            const result = yield* one(mirror, { asset, version, entries: catalog }).pipe(
              Effect.result,
            )

            if (Result.isSuccess(result)) {
              yield* records.stored(asset, { source: mirror.source, version })

              if (result.success.held > 0) totals.held += 1
              else if (result.success.stored > 0) totals.stored += 1
              else totals.unchanged += 1
              consecutive = 0
            } else {
              yield* records.failed(asset, {
                source: mirror.source,
                version,
                previous: state,
                reason: String(result.failure),
              })
              totals.failed += 1
              consecutive += 1
            }

            cursor = asset

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

      const mirrors = Object.entries(sources).flatMap(([name, { bulk }]): ReadonlyArray<Mirror> => {
        const source = Source.make(name)

        return bulk === undefined ? [] : [{ source, bulk }]
      })

      return Gather.of({ mirrors, check, gather, publish })
    }).pipe(Effect.orDie),
  )

  // Inside Workers, where the Workflow runs: D1, the SERIES bucket, and each
  // source asked directly, never through the cache or the store, paced with
  // a longer wait than a visitor's request.
  static readonly live = Gather.layer.pipe(
    Layer.provide(database),
    Layer.provide(Store.layer),
    Layer.provide(Sources.layer),
    Layer.provide(Insee.layer.pipe(Layer.provide(Pace.gathering))),
    Layer.provide(Ilostat.layer.pipe(Layer.provide(Pace.gathering))),
    Layer.provide(Vdem.layer),
    Layer.provide(Wid.layer),
    Layer.provide(Who.layer.pipe(Layer.provide(Pace.gathering))),
    Layer.provide(Faostat.layer.pipe(Layer.provide(Pace.gathering))),
    Layer.provide(Layer.merge(WorldBank.layer, Sdmx.layer).pipe(Layer.provide(Pace.gathering))),
  )

  // Workflow steps save cursors and failure streaks; the ledger survives runs.
  static readonly run = Effect.fn("Gather.run")(function* (source?: Source) {
    const gather = yield* Gather

    for (const mirror of gather.mirrors.filter(
      (item) => source === undefined || item.source === source,
    )) {
      if (mirror.bulk.release === undefined) yield* mirrorOne(mirror)
      else yield* gather.publish(mirror)
    }
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
