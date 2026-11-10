import { Relation, transformOf, Trend, type View, Year } from "@civicdata/domain"
import { Machine } from "@civicdata/machine"
import type { QueryClient } from "@tanstack/react-query"
import { Data, Effect, Match, Struct } from "effect"

import { resolveQuery } from "./api.ts"
import { overTime, type Spanned, withPicks, withTransform } from "./edits.ts"

// A View's whole history: every year the World Bank could have, with the
// View's series and transform. An index starts at the first year shown, so
// the history of an indexed trend holds the values as published.
export const historyOf = (view: View) => {
  const transform = transformOf(view)

  const history = Trend.make({
    indicator: view.indicator,
    countries: view.countries,
    from: Year.make(1960),
    to: Year.make(new Date().getUTCFullYear()),
  })

  return withTransform(
    view.dimensions === undefined ? history : withPicks(history, view.dimensions),
    transform === "Index" ? undefined : transform,
  )
}

// The years a chart over time starts from: its indicator's whole history, or
// for a relation, the years each country has a value for both indicators.
const historyFor = async (view: Spanned, queryClient: QueryClient) => {
  const main = queryClient.fetchQuery(resolveQuery(historyOf(view)))

  return Match.value(view).pipe(
    Match.tag("Ranking", async () => (await main).observations),
    Match.tag("Relation", async (relation) => {
      const [own, against] = await Promise.all([
        main,
        // The indicator it is plotted against, as published.
        queryClient.fetchQuery(
          resolveQuery(
            historyOf(
              Relation.make({
                ...Struct.omit(relation, ["dimensions"]),
                indicator: relation.against,
                against: relation.indicator,
              }),
            ),
          ),
        ),
      ])

      const held = new Set(against.observations.map(({ country, year }) => `${country} ${year}`))

      return own.observations.filter(({ country, year }) => held.has(`${country} ${year}`))
    }),
    Match.exhaustive,
  )
}

// Switching a chart of one year to over time: nothing asked, its history
// loading, or the history refused.
type Spanning = Data.TaggedEnum<{
  Idle: {}
  Loading: {}
  Failed: {}
}>

export const Spanning = Data.taggedEnum<Spanning>()

type SpanEvent = Data.TaggedEnum<{
  Ask: {}
  Loaded: { readonly view: View }
  Refused: {}
}>

export const SpanEvent = Data.taggedEnum<SpanEvent>()

// The chart one switch is for, and the cache its history loads through.
interface SpanInput {
  readonly view: Spanned
  readonly queryClient: QueryClient
}

// Hands back the chart over time, spanning the years its countries share.
// The machine belongs to one chart: another chart starts it again, and a
// history still loading for the previous one is dropped.
export const spanning = Machine.make<Spanning, SpanEvent, View>()({
  initial: () => Spanning.Idle(),
  on: {
    Idle: { Ask: () => Spanning.Loading(), ignore: ["Loaded", "Refused"] },
    Loading: {
      Loaded: (_, { view }) => Machine.emit(Spanning.Idle(), view),
      Refused: () => Spanning.Failed(),
      ignore: ["Ask"],
    },
    Failed: { Ask: () => Spanning.Loading(), ignore: ["Loaded", "Refused"] },
  },
  work: {
    Loading: (_, { view, queryClient }: SpanInput) =>
      Effect.tryPromise(() => historyFor(view, queryClient)).pipe(
        Effect.map((history) => SpanEvent.Loaded({ view: overTime(view, history) })),
        Effect.orElseSucceed(() => SpanEvent.Refused()),
      ),
  },
})
