import {
  type IndicatorId,
  IndicatorNotFound,
  type SeriesKey,
  Source,
  sourceOf,
  SourceUnavailable,
} from "@openfacts/domain"
import { Context, Effect, Layer, Option, Record } from "effect"

import { type Adapter, Policy } from "./Adapter.ts"
import { Cache } from "./Cache.ts"
import { Faostat } from "./Faostat.ts"
import { Ilostat } from "./Ilostat.ts"
import { Insee } from "./Insee.ts"
import { Pace } from "./Pace.ts"
import { Releases } from "./Releases.ts"
import { Sdmx } from "./Sdmx.ts"
import { choose, type Query } from "./Series.ts"
import { Store } from "./Store.ts"
import { Vdem } from "./Vdem.ts"
import { Who } from "./Who.ts"
import { WorldBank } from "./WorldBank.ts"

// Every source's adapter, by name. A caller picks one with `sourceOf`.
type Interface = Readonly<Record<Source, Adapter>> & {
  readonly "World Bank": Adapter
  readonly Eurostat: Adapter
  readonly OECD: Adapter
}

const read = (key: SeriesKey, { policy, target }: { policy: Policy; target: Store["Service"] }) =>
  target.read(key).pipe(
    Effect.catchTag("StoreUnavailable", (error) =>
      Policy.$is("StoredOnly")(policy)
        ? Effect.fail(
            new SourceUnavailable({
              source: sourceOf(key.indicator),
              reason: "StoreUnavailable",
            }),
          )
        : Effect.logWarning(
            "Store unavailable, asking the source",
            sourceOf(key.indicator),
            key.indicator,
            error,
          ).pipe(Effect.as(Option.none())),
    ),
  )

export class Sources extends Context.Service<Sources, Interface>()("@openfacts/server/Sources") {
  // A syntactically valid id need not name a registered publisher.
  static get(
    sources: Interface,
    indicator: IndicatorId,
  ): Effect.Effect<Adapter, IndicatorNotFound> {
    const source = sourceOf(indicator)
    const adapter = Object.hasOwn(sources, source) ? sources[source] : undefined

    return adapter === undefined
      ? Effect.fail(new IndicatorNotFound({ indicator }))
      : Effect.succeed(adapter)
  }

  static readonly pin = (sources: Interface) =>
    Effect.all(
      Record.map(sources, (adapter) =>
        Effect.gen(function* () {
          if (adapter.snapshot === undefined) return adapter
          // One lazy, shared snapshot per publisher per operation. An unavailable
          // unrelated publisher must not fail a chart that never reads it.
          const snapshot = yield* Effect.cached(adapter.snapshot)

          return {
            ...adapter,
            snapshot,
            describe: (indicator: IndicatorId) =>
              snapshot.pipe(Effect.flatMap((pinned) => pinned.describe(indicator))),
            fetch: (query: Query) => snapshot.pipe(Effect.flatMap((pinned) => pinned.fetch(query))),
          }
        }),
      ),
    )

  // Each source's adapter as its layer builds it.
  static readonly layer = Layer.effect(
    Sources,
    Effect.gen(function* () {
      const worldBank = yield* WorldBank
      const sdmx = yield* Sdmx
      const insee = yield* Insee
      const ilostat = yield* Ilostat
      const faostat = yield* Faostat
      const vdem = yield* Vdem
      const who = yield* Who

      return Sources.of({
        "World Bank": worldBank,
        ...sdmx,
        INSEE: insee,
        ILOSTAT: ilostat,
        FAOSTAT: faostat,
        "V-Dem": vdem,
        WHO: who,
      })
    }),
  )

  // The read path over the sources it is given, the same for every source: a
  // source whose policy stores its series answers a description and a series
  // from the store, filtered to the query, and asks its adapter on a miss or
  // when the store fails. The answer links the source's request that returns
  // the same values and reports when the stored series was fetched. A source
  // that stores nothing is always asked.
  static readonly stored = Layer.effect(
    Sources,
    Effect.gen(function* () {
      const sources = yield* Sources
      const store = yield* Store
      const releases = yield* Effect.serviceOption(Releases)

      const stored = (adapter: Adapter, target = store): Adapter => {
        const { policy } = adapter

        if (Policy.$is("Api")(policy)) return adapter
        const { url } = policy

        return {
          ...adapter,
          // A dimensionless series supplies stored metadata. Otherwise the
          // adapter supplies metadata, never an observations archive.
          describe: Effect.fn("Sources.describe")(function* (indicator: IndicatorId) {
            const found = yield* read({ indicator, dimensions: {} }, { policy, target })

            if (Option.isNone(found)) return yield* adapter.describe(indicator)

            const { dataset, retrievedAt } = found.value

            return { indicator: found.value.indicator, dataset, retrievedAt }
          }),
          fetch: Effect.fn("Sources.fetch")(function* (query) {
            if (Policy.$is("StoredOnly")(policy)) {
              const { dimensions } = yield* adapter.describe(query.indicator)

              if (dimensions !== undefined) yield* choose(query, dimensions)
            }

            const found = yield* read(query, { policy, target })

            if (Option.isNone(found)) {
              if (Policy.$is("StoredOnly")(policy))
                return yield* new SourceUnavailable({
                  source: sourceOf(query.indicator),
                  reason: "NotStored",
                })

              return yield* adapter.fetch(query)
            }

            const countries = new Set(query.countries)

            return {
              version: found.value.version,
              observations: found.value.observations.filter(
                ({ country, year }) =>
                  countries.has(country) && year >= query.from && year <= query.to,
              ),
              qualifications: (found.value.qualifications ?? []).filter(
                ({ country, year }) =>
                  countries.has(country) && year >= query.from && year <= query.to,
              ),
              url: url(query, found.value.version),
              retrievedAt: found.value.retrievedAt,
              dimensions: [],
            }
          }),
        }
      }

      const wrapped = Record.map(sources, (adapter, source): Adapter => {
        if (adapter.coherent !== true && adapter.bulk?.release === undefined) return stored(adapter)

        const snapshot = Effect.gen(function* () {
          const publisher = Source.make(source)

          if (Option.isNone(releases))
            return yield* new SourceUnavailable({ source: publisher, reason: "StoreUnavailable" })

          if (!Policy.$is("StoredOnly")(adapter.policy))
            return yield* new SourceUnavailable({ source: publisher })
          const active = yield* releases.value.current(publisher)

          const pinned = Option.isSome(active)
            ? store.namespace(active.value.namespace)
            : Store.of({ ...store, read: () => Effect.succeedNone })

          return stored(adapter, pinned)
        })

        return {
          ...adapter,
          snapshot,
          describe: (indicator) =>
            snapshot.pipe(Effect.flatMap((pinned) => pinned.describe(indicator))),
          fetch: (query) => snapshot.pipe(Effect.flatMap((pinned) => pinned.fetch(query))),
        }
      })

      return Sources.of({ ...sources, ...wrapped })
    }),
  )

  // As deployed: the store first, then each source's API through the cache,
  // paced.
  static readonly live = Sources.stored.pipe(
    Layer.provide(Sources.layer),
    Layer.provide(Insee.cached),
    Layer.provide(Who.cached),
    Layer.provide(Ilostat.layer),
    Layer.provide(Vdem.layer),
    Layer.provide(Faostat.layer),
    Layer.provide(Store.layer),
    Layer.provide(Releases.live),
    Layer.provide(WorldBank.cached),
    Layer.provide(Sdmx.cached),
    Layer.provide(Pace.http),
    Layer.provide(Cache.layer),
  )
}
