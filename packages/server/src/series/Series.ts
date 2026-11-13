import {
  Dimension,
  DimensionId,
  DimensionsMissing,
  Qualification,
  Observation,
  type SeriesKey,
  Year,
} from "@repo/domain"
import { DateTime, Effect } from "effect"

import type { Query } from "./Series.types.ts"

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
