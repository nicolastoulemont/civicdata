import { type IndicatorId, type SeriesKey, type Source, sourceOf } from "@civicdata/domain"
import { Context, Effect, Layer, Option, Record } from "effect"

import { type Adapter, Policy } from "./Adapter.ts"
import { Cache } from "./Cache.ts"
import { Pace } from "./Pace.ts"
import { Sdmx } from "./Sdmx.ts"
import { Store } from "./Store.ts"
import { WorldBank } from "./WorldBank.ts"

// Every source's adapter, by name. A caller picks one with `sourceOf`.
type Interface = { readonly [source in Source]: Adapter }

export class Sources extends Context.Service<Sources, Interface>()("@civicdata/server/Sources") {
  // Each source's adapter as its layer builds it.
  static readonly layer = Layer.effect(
    Sources,
    Effect.gen(function* () {
      const worldBank = yield* WorldBank
      const sdmx = yield* Sdmx

      return Sources.of({ "World Bank": worldBank, ...sdmx })
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

      const read = (key: SeriesKey) =>
        store
          .read(key)
          .pipe(
            Effect.catchTag("StoreUnavailable", (error) =>
              Effect.logWarning(
                "Store unavailable, asking the source",
                sourceOf(key.indicator),
                key.indicator,
                error,
              ).pipe(Effect.as(Option.none())),
            ),
          )

      const stored = (adapter: Adapter): Adapter =>
        Policy.$match(adapter.policy, {
          None: () => adapter,
          Full: ({ url }) => ({
            ...adapter,
            // An entry's description is read from its series without
            // dimensions: the World Bank's only series. A source whose series
            // have dimensions stores none, so it is asked.
            describe: Effect.fn("Sources.describe")(function* (indicator: IndicatorId) {
              const found = yield* read({ indicator, dimensions: {} })

              if (Option.isNone(found)) return yield* adapter.describe(indicator)

              const { dataset, retrievedAt } = found.value

              return { indicator: found.value.indicator, dataset, retrievedAt }
            }),
            fetch: Effect.fn("Sources.fetch")(function* (query) {
              const found = yield* read(query)

              if (Option.isNone(found)) return yield* adapter.fetch(query)

              const countries = new Set(query.countries)

              return {
                observations: found.value.observations.filter(
                  ({ country, year }) =>
                    countries.has(country) && year >= query.from && year <= query.to,
                ),
                url: url(query),
                retrievedAt: found.value.retrievedAt,
                dimensions: [],
              }
            }),
          }),
        })

      return Sources.of(Record.map(sources, stored))
    }),
  )

  // As deployed: the store first, then each source's API through the cache,
  // paced.
  static readonly live = Sources.stored.pipe(
    Layer.provide(Sources.layer),
    Layer.provide(Store.layer),
    Layer.provide(WorldBank.cached),
    Layer.provide(Sdmx.cached),
    Layer.provide(Pace.http),
    Layer.provide(Cache.layer),
  )
}
