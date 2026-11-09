import {
  applies,
  IndicatorId,
  IndicatorNotFound,
  type Observation,
  type ResolvedView,
  SourceUnavailable,
  type Transform,
  TransformNotApplicable,
  type View,
  Year,
} from "@civicdata/domain"
import { Array as Arr, Context, Effect, Layer, Match } from "effect"

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

interface Query {
  readonly indicator: IndicatorId
  readonly countries: View["countries"]
  readonly from: Year
  readonly to: Year
}

// The requested countries without a value in each of `series`: a change needs
// a value in both years, a relation one for both indicators.
const missing = (countries: View["countries"], series: ReadonlyArray<ReadonlyArray<Observation>>) =>
  countries.filter(
    (country) => !series.every((values) => values.some((value) => value.country === country)),
  )

export class Resolver extends Context.Service<Resolver, Interface>()("@civicdata/server/Resolver") {
  static readonly layer = Layer.effect(
    Resolver,
    Effect.gen(function* () {
      const worldBank = yield* WorldBank

      const series = Effect.fn("Resolver.series")(function* (query: Query) {
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

      // One indicator's values from `from` to `to`, after the transform, with
      // every series they were computed from.
      const values = Effect.fn("Resolver.values")(function* (
        query: Query & { readonly transform?: Transform },
      ) {
        const { from, transform } = query

        // Growth needs the year before the first one shown.
        const main = yield* series({
          ...query,
          from: transform === "Growth" ? Year.make(Math.max(1960, from - 1)) : from,
        })

        if (transform !== undefined && !applies(transform, main.described.indicator.name)) {
          return yield* new TransformNotApplicable({ indicator: query.indicator, transform })
        }

        const people =
          transform === "PerPerson" ? yield* series({ ...query, indicator: population }) : undefined

        const transformed = Match.value(transform).pipe(
          Match.when("PerPerson", () => perPerson(main.observations, people?.observations ?? [])),
          Match.when("Growth", () => growth(main.observations)),
          Match.when("Index", () => indexed(main.observations, from)),
          Match.orElse(() => main.observations),
        )

        const sources: ResolvedView["sources"] =
          people === undefined ? [main.source] : [main.source, people.source]

        return {
          title: titleOf(main.described.indicator),
          indicator: main.described.indicator,
          observations: transformed.filter((observation) => observation.year >= from),
          sources,
        }
      })

      const resolve = Effect.fn("Resolver.resolve")(function* (view: View) {
        const { countries } = view

        return yield* Match.valueTags(view, {
          Trend: (trend) =>
            values(trend).pipe(
              Effect.map((single) => ({
                view: trend,
                ...single,
                missing: missing(countries, [single.observations]),
              })),
            ),
          Ranking: (ranking) =>
            values({ ...ranking, from: ranking.year, to: ranking.year }).pipe(
              Effect.map((single) => ({
                view: ranking,
                ...single,
                missing: missing(countries, [single.observations]),
              })),
            ),
          // The years between are fetched with the two, and dropped.
          Change: (change) =>
            values(change).pipe(
              Effect.map((single) => {
                const at = (year: Year) =>
                  single.observations.filter((observation) => observation.year === year)

                const [from, to] = [at(change.from), at(change.to)]

                return {
                  view: change,
                  ...single,
                  observations: [...from, ...to],
                  missing: missing(countries, [from, to]),
                }
              }),
            ),
          Relation: (relation) =>
            Effect.all(
              [
                values({ ...relation, from: relation.year, to: relation.year }),
                values({
                  ...relation,
                  indicator: relation.against,
                  from: relation.year,
                  to: relation.year,
                }),
              ],
              { concurrency: 2 },
            ).pipe(
              Effect.map(([main, against]) => ({
                view: relation,
                title: main.title,
                indicator: main.indicator,
                observations: main.observations,
                against: {
                  title: against.title,
                  indicator: against.indicator,
                  observations: against.observations,
                },
                missing: missing(countries, [main.observations, against.observations]),
                sources: Arr.appendAll(main.sources, against.sources),
              })),
            ),
        })
      })

      return Resolver.of({ resolve })
    }),
  )
}
