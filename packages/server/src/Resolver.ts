import {
  IndicatorNotFound,
  type ResolvedView,
  SourceUnavailable,
  type View,
} from "@civicdata/domain"
import { Context, Effect, Layer, Match } from "effect"

import { WorldBank } from "./WorldBank.ts"

interface Interface {
  readonly resolve: (
    view: View,
  ) => Effect.Effect<ResolvedView, IndicatorNotFound | SourceUnavailable>
}

export class Resolver extends Context.Service<Resolver, Interface>()("@civicdata/server/Resolver") {
  static readonly layer = Layer.effect(
    Resolver,
    Effect.gen(function* () {
      const worldBank = yield* WorldBank

      const resolve = Effect.fn("Resolver.resolve")(function* (view: View) {
        const years = Match.valueTags(view, {
          Trend: (trend) => ({ from: trend.from, to: trend.to }),
          Ranking: (ranking) => ({ from: ranking.year, to: ranking.year }),
        })

        const [described, series] = yield* Effect.all(
          [
            worldBank.describe(view.indicator),
            worldBank.observations({
              indicator: view.indicator,
              countries: view.countries,
              ...years,
            }),
          ],
          { concurrency: 2 },
        )

        const reported = new Set(series.observations.map((observation) => observation.country))

        return {
          view,
          indicator: described.indicator,
          observations: series.observations,
          missing: view.countries.filter((country) => !reported.has(country)),
          provenance: {
            source: "World Bank" as const,
            dataset: described.dataset,
            url: series.url,
            retrievedAt: series.retrievedAt,
          },
        }
      })

      return Resolver.of({ resolve })
    }),
  )
}
