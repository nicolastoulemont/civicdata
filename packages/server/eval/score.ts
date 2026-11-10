import {
  Answered,
  Asked,
  type Chart as Drawing,
  type Country,
  type Ending,
  type Overlay,
  type Transform,
  transformOf,
  Unanswered,
  type View,
} from "@civicdata/domain"
import { Array as Arr, Data, Match, Schema } from "effect"

// Series of an SDMX dataflow that answer a question: the values the chart may
// pick of each dimension named, e.g. { sex: ["T"], age: ["Y15-74"] }. A
// dimension left out is not scored.
interface Series {
  readonly indicator: string
  readonly dimensions: Readonly<Record<string, Arr.NonEmptyReadonlyArray<string>>>
}

// What a chart in a case must show. Any of `indicators`, World Bank codes, or
// of `series`, Eurostat and OECD ones, is right, since some questions fit
// close indicators equally well. Countries must match as a set. No
// `transform` means values as published. Years left out are not scored:
// without years in the question, the default range moves with the calendar.
// `overlays`, the political context the chart draws, must match as a set,
// none being []; left out, it is not scored.
interface Chart {
  readonly indicators?: ReadonlyArray<string>
  readonly series?: ReadonlyArray<Series>
  readonly countries: ReadonlyArray<Country>
  readonly transform?: Transform
  readonly overlays?: ReadonlyArray<Overlay>
}

// The chart types a case can expect. A relation plots its indicator against
// any of `against`.
type Types = {
  Trend: Chart & { readonly from?: number; readonly to?: number }
  Ranking: Chart & { readonly year?: number }
  Map: Chart & { readonly year?: number }
  Change: Chart & { readonly from?: number; readonly to?: number }
  Relation: Chart & { readonly against: ReadonlyArray<string>; readonly year?: number }
}

// One chart a case expects.
type Drawn = Data.TaggedEnum<Types>

// One answer a case accepts: a single chart, several charts in the order the
// agent draws them, a question back, or no chart.
export type Expected = Data.TaggedEnum<
  Types & {
    Charts: { readonly charts: Arr.NonEmptyReadonlyArray<Drawn> }
    // The agent asks which reading of the question is meant.
    Asked: {}
    // The agent shows no chart, because no indicator measures the question.
    Unanswered: {}
  }
>

export const Expected = Data.taggedEnum<Expected>()

// The parts of a chart a case scores, with a ranking's year as a one-year
// range, and the indicator a relation plots against.
interface Parts {
  readonly chart: "trend" | "ranking" | "map" | "change" | "relation"
  readonly from?: number | undefined
  readonly to?: number | undefined
  readonly against?: string | undefined
}

const partsOf = (view: View): Parts =>
  Match.valueTags(view, {
    Trend: ({ from, to }): Parts => ({ chart: "trend", from, to }),
    Ranking: ({ year, as }): Parts => ({
      chart: as === "Map" ? "map" : "ranking",
      from: year,
      to: year,
    }),
    Change: ({ from, to }): Parts => ({ chart: "change", from, to }),
    Relation: ({ year, against }): Parts => ({ chart: "relation", from: year, to: year, against }),
  })

// The parts a case wants, with the indicators a relation may plot against.
interface Wanted extends Chart {
  readonly chart: Parts["chart"]
  readonly from?: number | undefined
  readonly to?: number | undefined
  readonly against?: ReadonlyArray<string>
}

const describe = (transform: Transform | undefined) =>
  transform === undefined
    ? "none"
    : Match.value(transform).pipe(
        Match.when({ _tag: "Ratio" }, ({ per }) => `per ${per}`),
        Match.orElse((plain) => plain),
      )

// "a trend", "a ranking and a change".
const listed = (types: ReadonlyArray<Parts["chart"]>) =>
  types.map((type) => `a ${type}`).join(" and ")

const endingOf = (ending: Ending) =>
  Match.valueTags(ending, {
    Answered: ({ charts }) => listed(charts.map(({ view }) => partsOf(view).chart)),
    Asked: ({ question }) => `the question "${question}"`,
    Unanswered: () => "no chart",
    Stopped: () => "stopped",
  })

const isAnswered = Schema.is(Answered)
const isAsked = Schema.is(Asked)
const isUnanswered = Schema.is(Unanswered)

// How the chart's picks differ from the series wanted, one line per dimension.
const seriesDifferences = (view: View, wanted: Series): ReadonlyArray<string> => {
  const picks = new Map<string, string>(Object.entries(view.dimensions ?? {}))

  return Object.entries(wanted.dimensions).flatMap(([dimension, codes]) => {
    const picked = picks.get(dimension)

    return picked !== undefined && codes.includes(picked)
      ? []
      : [`${dimension} ${picked ?? "none"}, want ${codes.join(" or ")}`]
  })
}

const sameSet = <A>(got: ReadonlyArray<A>, want: ReadonlyArray<A>) =>
  got.length === want.length && want.every((each) => got.includes(each))

const named = (overlays: ReadonlyArray<Overlay>) =>
  overlays.length === 0 ? "none" : overlays.join(", ")

// How the chart's political context differs from the one a case names.
const overlaysDiffer = (
  drawn: ReadonlyArray<Overlay> = [],
  want: ReadonlyArray<Overlay> | undefined,
): ReadonlyArray<string> =>
  want === undefined || sameSet(drawn, want)
    ? []
    : [`overlays ${named(drawn)}, want ${named(want)}`]

// How the chart differs from the one expected, one line per difference.
const compare = ({ view, overlays }: Drawing, want: Wanted): ReadonlyArray<string> => {
  const got = partsOf(view)

  if (got.chart !== want.chart) return [`a ${got.chart}, want a ${want.chart}`]

  const series = want.series ?? []
  const codes = [...(want.indicators ?? []), ...series.map(({ indicator }) => indicator)]
  const wanted = series.find(({ indicator }) => indicator === view.indicator)

  const checks: ReadonlyArray<readonly [boolean, string]> = [
    [codes.includes(view.indicator), `indicator ${view.indicator}, want ${codes.join(" or ")}`],
    [
      sameSet(view.countries, want.countries),
      `countries ${view.countries.join(", ")}, want ${want.countries.join(", ")}`,
    ],
    [
      describe(transformOf(view)) === describe(want.transform),
      `transform ${describe(transformOf(view))}, want ${describe(want.transform)}`,
    ],
    [want.from === undefined || got.from === want.from, `from ${got.from}, want ${want.from}`],
    [want.to === undefined || got.to === want.to, `to ${got.to}, want ${want.to}`],
    [
      want.against === undefined ||
        (got.against !== undefined && want.against.includes(got.against)),
      `against ${got.against}, want ${want.against?.join(" or ")}`,
    ],
  ]

  return [
    ...checks.flatMap(([right, difference]) => (right ? [] : [difference])),
    ...overlaysDiffer(overlays, want.overlays),
    ...(wanted === undefined ? [] : seriesDifferences(view, wanted)),
  ]
}

// The parts a case wants of a chart, with a year as a one-year range.
const wantedOf = (drawn: Drawn): Wanted =>
  Match.valueTags(drawn, {
    Trend: (trend): Wanted => ({ ...trend, chart: "trend" }),
    Ranking: (ranking): Wanted => ({
      ...ranking,
      chart: "ranking",
      from: ranking.year,
      to: ranking.year,
    }),
    Map: (map): Wanted => ({ ...map, chart: "map", from: map.year, to: map.year }),
    Change: (change): Wanted => ({ ...change, chart: "change" }),
    Relation: (relation): Wanted => ({
      ...relation,
      chart: "relation",
      from: relation.year,
      to: relation.year,
    }),
  })

// How the answer's charts differ from those wanted, in order. Each chart's
// differences name its place when either side has several.
const chartsDiffer = (wanted: Arr.NonEmptyReadonlyArray<Wanted>, ending: Ending) => {
  if (!isAnswered(ending)) {
    return [`${endingOf(ending)}, want ${listed(wanted.map(({ chart }) => chart))}`]
  }

  const { charts } = ending
  const several = charts.length > 1 || wanted.length > 1

  const count =
    charts.length === wanted.length
      ? []
      : [`${charts.length} ${charts.length === 1 ? "chart" : "charts"}, want ${wanted.length}`]

  return [
    ...count,
    ...wanted.flatMap((want, place) => {
      const drawn = charts[place]

      if (drawn === undefined) return []

      const differences = compare(drawn, want)

      return several ? differences.map((line) => `chart ${place + 1}: ${line}`) : differences
    }),
  ]
}

const differencesFrom = (expected: Expected, ending: Ending): ReadonlyArray<string> =>
  Expected.$match(expected, {
    Trend: (one) => chartsDiffer([wantedOf(one)], ending),
    Ranking: (one) => chartsDiffer([wantedOf(one)], ending),
    Map: (one) => chartsDiffer([wantedOf(one)], ending),
    Change: (one) => chartsDiffer([wantedOf(one)], ending),
    Relation: (one) => chartsDiffer([wantedOf(one)], ending),
    Charts: ({ charts }) => chartsDiffer(Arr.map(charts, wantedOf), ending),
    Asked: () => (isAsked(ending) ? [] : [`${endingOf(ending)}, want a question`]),
    Unanswered: () => (isUnanswered(ending) ? [] : [`${endingOf(ending)}, want no chart`]),
  })

// How the agent's answer differs from the closest answer a case accepts. An
// empty list means the answer is right.
export const score = (
  accepted: Arr.NonEmptyReadonlyArray<Expected>,
  ending: Ending,
): ReadonlyArray<string> =>
  Arr.map(accepted, (expected) => differencesFrom(expected, ending)).reduce((closest, next) =>
    next.length < closest.length ? next : closest,
  )
