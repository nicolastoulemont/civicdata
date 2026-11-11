import {
  type Country,
  Dimension,
  DimensionId,
  DimensionsMissing,
  Indicator,
  Qualification,
  Observation,
  type SeriesKey,
  Year,
} from "@openfacts/domain"
import { DateTime, Effect, Schema } from "effect"

// What the Resolver asks a source adapter for: one series' values for some
// countries and years.
export interface Query extends SeriesKey {
  readonly countries: ReadonlyArray<Country>
  readonly from: Year
  readonly to: Year
}

// Every result records when its source was asked, so a cached result still
// reports its original retrieval time as provenance.
export const Described = Schema.Struct({
  dimensions: Schema.optionalKey(Schema.Array(Dimension)),
  indicator: Indicator,
  dataset: Schema.String,
  retrievedAt: Schema.DateTimeUtc,
})

export type Described = typeof Described.Type

export const Series = Schema.Struct({
  version: Schema.optionalKey(Schema.NonEmptyString),
  observations: Schema.Array(Observation),
  qualifications: Schema.optionalKey(Schema.Array(Qualification)),
  url: Schema.String,
  retrievedAt: Schema.DateTimeUtc,
})

export type Series = typeof Series.Type

// What a source answers for one series: its values, and what else the
// indicator's series differ by, with the values each dimension takes, so the
// page can offer the others. A World Bank indicator differs by none.
export const Answer = Schema.Struct({ ...Series.fields, dimensions: Schema.Array(Dimension) })

export type Answer = typeof Answer.Type

// How many years before this one a cached adapter asks a source for.
const depth = 30

// The years a cached adapter asks a source for whenever a query falls inside
// them: the last `depth` and this one. Every query inside them for the same
// indicator, countries and series then shares one stored answer, so find_years
// and the chart drawn after it cost one source request.
export const recent = Effect.map(DateTime.now, (now) => {
  const year = DateTime.getPartUtc(now, "year")

  return { from: Year.make(Math.max(1960, year - depth)), to: Year.make(year) }
})

// Asks `ask` for the recent years when the query ends inside them, from the
// query's first year when it starts before them, and answers with the query's
// years only. find_years and the chart drawn after it then share one stored
// answer over 50 years too. A query past this year is asked as is.
export const widen =
  <
    Q extends Query,
    A extends {
      readonly observations: ReadonlyArray<Observation>
      readonly qualifications?: ReadonlyArray<Qualification>
    },
    E,
    R,
  >(
    ask: (query: Q) => Effect.Effect<A, E, R>,
  ) =>
  (query: Q) =>
    Effect.gen(function* () {
      const years = yield* recent

      if (query.to > years.to) return yield* ask(query)

      const answer = yield* ask({
        ...query,
        from: query.from < years.from ? query.from : years.from,
        to: years.to,
      })

      return {
        ...answer,
        qualifications: (answer.qualifications ?? []).filter(
          ({ year }) => year >= query.from && year <= query.to,
        ),
        observations: answer.observations.filter(
          ({ year }) => year >= query.from && year <= query.to,
        ),
      }
    })

// Every choice, including a singleton, remains available when discovery was truncated.
export const choose = Effect.fn("Series.choose")(function* (
  key: SeriesKey,
  dimensions: ReadonlyArray<Dimension>,
) {
  const open = dimensions.flatMap(({ id, options }) =>
    options.some(({ code }) => code === key.dimensions[id]) ? [] : [id],
  )

  const extra = Object.keys(key.dimensions).flatMap((id) =>
    dimensions.some((dimension) => dimension.id === id) ? [] : [DimensionId.make(id)],
  )

  const [first, ...rest] = [...open, ...extra]

  if (first !== undefined)
    return yield* new DimensionsMissing({
      indicator: key.indicator,
      dimensions,
      open: [first, ...rest],
    })

  return undefined
})
