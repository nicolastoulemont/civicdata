import { Country, type Observation, type ResolvedView, Year } from "@civicdata/domain"
import { Array as Arr, Match, Order, Schema } from "effect"

const Point = Schema.Struct({ year: Year, value: Schema.Finite })

type Point = typeof Point.Type

// Where one line of a trend or a change starts, ends, and is lowest and
// highest.
const Line = Schema.Struct({
  country: Country,
  first: Point,
  last: Point,
  lowest: Point,
  highest: Point,
})

const Lines = Schema.TaggedStruct("Lines", {
  name: Schema.String,
  from: Year,
  to: Year,
  lines: Schema.Array(Line),
  missing: Schema.Array(Country),
})

// A ranking's values, highest first.
const Bars = Schema.TaggedStruct("Bars", {
  name: Schema.String,
  year: Year,
  bars: Schema.Array(Schema.Struct({ country: Country, value: Schema.Finite })),
  missing: Schema.Array(Country),
})

// A relation's dots: each country's value of the indicator and of the one it
// is plotted against, named in `against`.
const Dots = Schema.TaggedStruct("Dots", {
  name: Schema.String,
  against: Schema.String,
  year: Year,
  dots: Schema.Array(
    Schema.Struct({ country: Country, value: Schema.Finite, against: Schema.Finite }),
  ),
  missing: Schema.Array(Country),
})

// What show_chart tells the model about the values it charted, so it can
// write about it: the indicator's official name, which carries its unit,
// the years the chart covers, and a trend's or a change's lines, a ranking's
// bars, or a relation's dots. `missing` lists the countries the chart has no
// value for.
export const Summary = Schema.Union([Lines, Bars, Dots])

export type Summary = typeof Summary.Type

const byYear = Order.mapInput(Order.Number, (observation: Observation) => observation.year)
const byValue = Order.mapInput(Order.Number, (observation: Observation) => observation.value)

const pointOf = ({ year, value }: Observation): Point => ({ year, value })

const lineOf = (observations: Arr.NonEmptyReadonlyArray<Observation>) => ({
  country: observations[0].country,
  first: pointOf(Arr.min(observations, byYear)),
  last: pointOf(Arr.max(observations, byYear)),
  lowest: pointOf(Arr.min(observations, byValue)),
  highest: pointOf(Arr.max(observations, byValue)),
})

const lines = (
  { indicator, observations, missing }: ResolvedView,
  { from, to }: { readonly from: Year; readonly to: Year },
) =>
  Lines.make({
    name: indicator.name,
    from,
    to,
    lines: Object.values(Arr.groupBy(observations, (observation) => observation.country)).map(
      lineOf,
    ),
    missing,
  })

const bars = ({ indicator, observations, missing }: ResolvedView, year: Year) =>
  Bars.make({
    name: indicator.name,
    year,
    bars: Arr.sort(observations, Order.flip(byValue)).map(({ country, value }) => ({
      country,
      value,
    })),
    missing,
  })

// Only a relation holds the values it is plotted against.
export const summarize = (resolved: ResolvedView): Summary =>
  "against" in resolved
    ? Dots.make({
        name: resolved.indicator.name,
        against: resolved.against.indicator.name,
        year: resolved.view.year,
        dots: resolved.observations.flatMap(({ country, value }) =>
          resolved.against.observations
            .filter((other) => other.country === country)
            .map((other) => ({ country, value, against: other.value })),
        ),
        missing: resolved.missing,
      })
    : Match.valueTags(resolved.view, {
        Trend: (trend) => lines(resolved, trend),
        Change: (change) => lines(resolved, change),
        Ranking: ({ year }) => bars(resolved, year),
      })
