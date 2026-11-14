import {
  type Break,
  type Flag,
  inYear,
  type Observation,
  type Ranked,
  type Related,
  type ResolvedView,
  type Year,
} from "@repo/domain"
import { Array as Arr, Match, Order } from "effect"

import { Bars, Dots, Lines, type Point, type Summary } from "../Summary.schemas.ts"

const byYear = Order.mapInput(Order.Number, (observation: Observation) => observation.year)
const byValue = Order.mapInput(Order.Number, (observation: Observation) => observation.value)

const marked = (observations: ReadonlyArray<Observation>, flag: Flag) =>
  observations.filter((observation) => observation.flags?.includes(flag) === true)

// A change passes its own breaks: it shows two years and drops those between.
const flaggedOf = (
  shown: ReadonlyArray<Observation>,
  breaks: ReadonlyArray<Break> = marked(shown, "Break").map(({ country, year }) => ({
    country,
    year,
  })),
) => ({
  breaks,
  provisional: marked(shown, "Provisional").length,
  estimated: marked(shown, "Estimated").length,
})

const pointOf = ({ year, value }: Observation): Point => ({ year, value })

const lineOf = (observations: Arr.NonEmptyReadonlyArray<Observation>) => ({
  country: observations[0].country,
  first: pointOf(Arr.min(observations, byYear)),
  last: pointOf(Arr.max(observations, byYear)),
  lowest: pointOf(Arr.min(observations, byValue)),
  highest: pointOf(Arr.max(observations, byValue)),
})

const inputsOf = (sources: ResolvedView["sources"]) => {
  const inputs = sources.flatMap((source) => source.inputs ?? [])

  return Arr.isArrayNonEmpty(inputs) ? inputs : undefined
}

const lines = (
  { indicator, observations, missing, qualifications, sources }: ResolvedView,
  {
    from,
    to,
    breaks,
  }: { readonly from: Year; readonly to: Year; readonly breaks?: ReadonlyArray<Break> },
) =>
  Lines.make({
    name: indicator.name,
    from,
    to,
    lines: Object.values(Arr.groupBy(observations, (observation) => observation.country)).map(
      lineOf,
    ),
    missing,
    qualifications: qualifications ?? [],
    inputs: inputsOf(sources),
    flagged: flaggedOf(observations, breaks),
  })

const ranked = (observations: ReadonlyArray<Observation>) =>
  Arr.sort(observations, Order.flip(byValue)).map(({ country, value }) => ({ country, value }))

const bars = (resolved: Ranked) => {
  const { view, indicator } = resolved
  const { observations, missing } = inYear(resolved, view.year)
  const at = (year: Year) => ({ year, bars: ranked(inYear(resolved, year).observations) })

  const shown = {
    name: indicator.name,
    year: view.year,
    bars: ranked(observations),
    missing,
    qualifications: resolved.qualifications ?? [],
    inputs: inputsOf(resolved.sources),
    flagged: flaggedOf(resolved.observations),
  }

  return view.span === undefined
    ? Bars.make(shown)
    : Bars.make({ ...shown, span: { from: at(view.span.from), to: at(view.span.to) } })
}

// Each country with a value of both indicators in the relation's one year.
const paired = ({ observations, against }: Related) =>
  observations.flatMap(({ country, value }) =>
    against.observations
      .filter((other) => other.country === country)
      .map((other) => ({ country, value, against: other.value })),
  )

const dots = (resolved: Related) => {
  const { view } = resolved
  const shown = inYear(resolved, view.year)
  const at = (year: Year) => ({ year, dots: paired(inYear(resolved, year)) })

  const told = {
    name: resolved.indicator.name,
    against: resolved.against.indicator.name,
    year: view.year,
    dots: paired(shown),
    missing: shown.missing,
    qualifications: resolved.qualifications ?? [],
    inputs: inputsOf(resolved.sources),
    flagged: flaggedOf(resolved.observations),
  }

  return view.span === undefined
    ? Dots.make(told)
    : Dots.make({ ...told, span: { from: at(view.span.from), to: at(view.span.to) } })
}

// Only a relation holds the values it is plotted against, and only a change
// the breaks between its two years.
export const summarize = (resolved: ResolvedView): Summary => {
  if ("breaks" in resolved) return lines(resolved, { ...resolved.view, breaks: resolved.breaks })

  return "against" in resolved
    ? dots(resolved)
    : Match.valueTags(resolved.view, {
        Trend: (trend) => lines(resolved, trend),
        Ranking: (view) => bars({ ...resolved, view }),
      })
}
