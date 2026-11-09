import {
  applies,
  type Dimensions,
  type DimensionsMissing,
  IndicatorId,
  IndicatorNotFound,
  type Observation,
  type ResolvedView,
  SourceUnavailable,
  sourceOf,
  type Transform,
  TransformNotApplicable,
  type View,
  Year,
} from "@civicdata/domain"
import { Array as Arr, Context, Effect, Layer, Match } from "effect"

import { Sdmx } from "./Sdmx.ts"
import type { Query } from "./Series.ts"
import { titleOf } from "./Titles.ts"
import { divide, growth, indexed } from "./transforms.ts"
import { WorldBank } from "./WorldBank.ts"

interface Interface {
  readonly resolve: (
    view: View,
  ) => Effect.Effect<
    ResolvedView,
    IndicatorNotFound | SourceUnavailable | TransformNotApplicable | DimensionsMissing
  >
}

// "Per person" divides by this World Bank series.
const population = IndicatorId.make("SP.POP.TOTL")

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
      const sdmx = yield* Sdmx

      const series = Effect.fn("Resolver.series")(function* (
        query: Query & { readonly dimensions?: Dimensions | undefined },
      ) {
        const source = sourceOf(query.indicator)

        // Eurostat and OECD both publish SDMX; their series pick a value of
        // each dimension. World Bank indicators have none.
        const [described, fetched] = yield* Effect.all(
          source === "World Bank"
            ? [
                worldBank.describe(query.indicator),
                worldBank
                  .observations(query)
                  .pipe(Effect.map((found) => ({ ...found, dimensions: [] }))),
              ]
            : [
                sdmx.describe(query.indicator),
                sdmx.observations({ ...query, dimensions: query.dimensions ?? {} }),
              ],
          { concurrency: 2 },
        )

        return {
          described,
          dimensions: fetched.dimensions,
          observations: fetched.observations,
          source: {
            indicator: query.indicator,
            name: described.indicator.name,
            source,
            dataset: described.dataset,
            url: fetched.url,
            retrievedAt: fetched.retrievedAt,
          },
        }
      })

      // One indicator's values from `from` to `to`, after the transform, with
      // every series they were computed from.
      const values = Effect.fn("Resolver.values")(function* (
        query: Query & {
          readonly transform?: Transform
          readonly dimensions?: Dimensions | undefined
        },
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

        // Per person and a ratio divide by another series, which the chart cites.
        const divisor = Match.value(transform).pipe(
          Match.when("PerPerson", () => population),
          Match.when({ _tag: "Ratio" }, (ratio) => ratio.per),
          Match.orElse(() => undefined),
        )

        const by =
          divisor === undefined
            ? undefined
            : yield* series({ ...query, indicator: divisor, dimensions: {} })

        const transformed = Match.value(transform).pipe(
          Match.when("Growth", () => growth(main.observations)),
          Match.when("Index", () => indexed(main.observations, from)),
          Match.orElse(() =>
            by === undefined ? main.observations : divide(main.observations, by.observations),
          ),
        )

        const sources: ResolvedView["sources"] =
          by === undefined ? [main.source] : [main.source, by.source]

        return {
          title: titleOf(main.described.indicator),
          indicator: main.described.indicator,
          observations: transformed.filter((observation) => observation.year >= from),
          dimensions: main.dimensions,
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
                // The View's dimensions pick the series of `indicator` only.
                values({
                  ...relation,
                  indicator: relation.against,
                  dimensions: {},
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
                dimensions: main.dimensions,
                sources: Arr.appendAll(main.sources, against.sources),
              })),
            ),
        })
      })

      return Resolver.of({ resolve })
    }),
  )
}
