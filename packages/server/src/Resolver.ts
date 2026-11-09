import {
  applies,
  IndicatorId,
  IndicatorNotFound,
  type ResolvedView,
  SourceUnavailable,
  TransformNotApplicable,
  type View,
  Year,
} from "@civicdata/domain"
import { Context, Effect, Layer, Match } from "effect"

import { titleOf } from "./Titles.ts"
import { growth, indexed, perPerson } from "./transforms.ts"
import { WorldBank } from "./WorldBank.ts"

interface Interface {
  readonly resolve: (
    view: View,
  ) => Effect.Effect<ResolvedView, IndicatorNotFound | SourceUnavailable | TransformNotApplicable>
}

// "Per person" divides by this World Bank series.
const population = IndicatorId.make("SP.POP.TOTL")

export class Resolver extends Context.Service<Resolver, Interface>()("@civicdata/server/Resolver") {
  static readonly layer = Layer.effect(
    Resolver,
    Effect.gen(function* () {
      const worldBank = yield* WorldBank

      const series = Effect.fn("Resolver.series")(function* (query: {
        readonly indicator: IndicatorId
        readonly countries: View["countries"]
        readonly from: Year
        readonly to: Year
      }) {
        const [described, fetched] = yield* Effect.all(
          [worldBank.describe(query.indicator), worldBank.observations(query)],
          { concurrency: 2 },
        )

        return {
          described,
          observations: fetched.observations,
          source: {
            indicator: query.indicator,
            source: "World Bank" as const,
            dataset: described.dataset,
            url: fetched.url,
            retrievedAt: fetched.retrievedAt,
          },
        }
      })

      const resolve = Effect.fn("Resolver.resolve")(function* (view: View) {
        const { from, to } = Match.valueTags(view, {
          Trend: (trend) => ({ from: trend.from, to: trend.to }),
          Ranking: (ranking) => ({ from: ranking.year, to: ranking.year }),
        })

        // Growth needs the year before the first one shown.
        const fetchFrom = view.transform === "Growth" ? Year.make(Math.max(1960, from - 1)) : from

        const main = yield* series({
          indicator: view.indicator,
          countries: view.countries,
          from: fetchFrom,
          to,
        })

        const name = main.described.indicator.name

        if (view.transform !== undefined && !applies(view.transform, name)) {
          return yield* new TransformNotApplicable({
            indicator: view.indicator,
            transform: view.transform,
          })
        }

        const people =
          view.transform === "PerPerson"
            ? yield* series({ indicator: population, countries: view.countries, from, to })
            : undefined

        const values = Match.value(view.transform).pipe(
          Match.when("PerPerson", () => perPerson(main.observations, people?.observations ?? [])),
          Match.when("Growth", () => growth(main.observations)),
          Match.when("Index", () => indexed(main.observations, from)),
          Match.orElse(() => main.observations),
        )

        const observations = values.filter((observation) => observation.year >= from)
        const reported = new Set(observations.map((observation) => observation.country))

        const sources: ResolvedView["sources"] =
          people === undefined ? [main.source] : [main.source, people.source]

        return {
          view,
          title: titleOf(main.described.indicator),
          indicator: main.described.indicator,
          observations,
          missing: view.countries.filter((country) => !reported.has(country)),
          sources,
        }
      })

      return Resolver.of({ resolve })
    }),
  )
}
