import {
  Answered,
  Asked,
  type Country,
  type Ending,
  type Transform,
  transformOf,
  Unanswered,
  type View,
} from "@civicdata/domain"
import { Array as Arr, Data, Match, Schema } from "effect"

// What a chart in a case must show. Any of `indicators` is right, since some
// questions fit close indicators equally well. Countries must match as a set.
// No `transform` means values as published. Years left out are not scored:
// without years in the question, the default range moves with the calendar.
interface Chart {
  readonly indicators: Arr.NonEmptyReadonlyArray<string>
  readonly countries: ReadonlyArray<Country>
  readonly transform?: Transform
}

// One answer a case accepts.
export type Expected = Data.TaggedEnum<{
  Trend: Chart & { readonly from?: number; readonly to?: number }
  Ranking: Chart & { readonly year?: number }
  // The agent asks which reading of the question is meant.
  Asked: {}
  // The agent shows no chart, because no indicator measures the question.
  Unanswered: {}
}>

export const Expected = Data.taggedEnum<Expected>()

// The parts of a chart a case scores, with a ranking's year as a one-year range.
interface Parts {
  readonly chart: "trend" | "ranking" | "change" | "relation"
  readonly from?: number | undefined
  readonly to?: number | undefined
}

const partsOf = (view: View): Parts =>
  Match.valueTags(view, {
    Trend: ({ from, to }): Parts => ({ chart: "trend", from, to }),
    Ranking: ({ year }): Parts => ({ chart: "ranking", from: year, to: year }),
    Change: ({ from, to }): Parts => ({ chart: "change", from, to }),
    Relation: ({ year }): Parts => ({ chart: "relation", from: year, to: year }),
  })

const describe = (transform: Transform | undefined) =>
  transform === undefined
    ? "none"
    : Match.value(transform).pipe(
        Match.when({ _tag: "Ratio" }, ({ per }) => `per ${per}`),
        Match.orElse((plain) => plain),
      )

const endingOf = (ending: Ending) =>
  Match.valueTags(ending, {
    Answered: ({ view }) => `a ${partsOf(view).chart}`,
    Asked: ({ question }) => `the question "${question}"`,
    Unanswered: () => "no chart",
  })

const isAnswered = Schema.is(Answered)
const isAsked = Schema.is(Asked)
const isUnanswered = Schema.is(Unanswered)

const sameCountries = (got: ReadonlyArray<Country>, want: ReadonlyArray<Country>) =>
  got.length === want.length && want.every((country) => got.includes(country))

// How the chart differs from the one expected, one line per difference.
const compare = (view: View, want: Chart & Parts): ReadonlyArray<string> => {
  const got = partsOf(view)

  if (got.chart !== want.chart) return [`a ${got.chart}, want a ${want.chart}`]

  const checks: ReadonlyArray<readonly [boolean, string]> = [
    [
      want.indicators.includes(view.indicator),
      `indicator ${view.indicator}, want ${want.indicators.join(" or ")}`,
    ],
    [
      sameCountries(view.countries, want.countries),
      `countries ${view.countries.join(", ")}, want ${want.countries.join(", ")}`,
    ],
    [
      describe(transformOf(view)) === describe(want.transform),
      `transform ${describe(transformOf(view))}, want ${describe(want.transform)}`,
    ],
    [want.from === undefined || got.from === want.from, `from ${got.from}, want ${want.from}`],
    [want.to === undefined || got.to === want.to, `to ${got.to}, want ${want.to}`],
  ]

  return checks.flatMap(([right, difference]) => (right ? [] : [difference]))
}

const differencesFrom = (expected: Expected, ending: Ending): ReadonlyArray<string> => {
  const chart = (want: Chart & Parts) =>
    isAnswered(ending) ? compare(ending.view, want) : [`${endingOf(ending)}, want a ${want.chart}`]

  return Expected.$match(expected, {
    Trend: (trend) => chart({ ...trend, chart: "trend" }),
    Ranking: (ranking) =>
      chart({ ...ranking, chart: "ranking", from: ranking.year, to: ranking.year }),
    Asked: () => (isAsked(ending) ? [] : [`${endingOf(ending)}, want a question`]),
    Unanswered: () => (isUnanswered(ending) ? [] : [`${endingOf(ending)}, want no chart`]),
  })
}

// How the agent's answer differs from the closest answer a case accepts. An
// empty list means the answer is right.
export const score = (
  accepted: Arr.NonEmptyReadonlyArray<Expected>,
  ending: Ending,
): ReadonlyArray<string> =>
  Arr.map(accepted, (expected) => differencesFrom(expected, ending)).reduce((closest, next) =>
    next.length < closest.length ? next : closest,
  )
