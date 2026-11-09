import { Country, type Observation, type ResolvedView, Year } from "@civicdata/domain"
import { Array as Arr, Match, Option, Order, Schema } from "effect"

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
// write a takeaway: the indicator's official name, which carries its unit,
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

// How a takeaway is written, for the agent's instructions and for explaining
// a chart on its own.
export const rules =
  "two short sentences of plain text, without Markdown, on what the chart shows, read from its data. Say which way each country moves, which is highest or lowest, or how the two indicators go together. Take every number and year from that data, rounded if you like; never work one out, such as a difference, a ratio or an average."

// A number as a takeaway writes it, e.g. "72", "1,234.5" or "2.1 trillion".
// Digits inside a word, as in "G7" or "CO2", are part of a name, not a number.
const numbers =
  /(?<![\p{L}\p{N}.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s?(thousand|million|billion|bn|trillion|tn)\b)?(?![\p{L}\p{N}])/giu

const scales = new Map([
  ["thousand", 1e3],
  ["million", 1e6],
  ["billion", 1e9],
  ["bn", 1e9],
  ["trillion", 1e12],
  ["tn", 1e12],
])

interface Written {
  readonly text: string
  readonly value: number
  // How far the written value may be from the data it rounds: half its last digit.
  readonly tolerance: number
}

const writtenIn = (text: string): ReadonlyArray<Written> =>
  Array.from(text.matchAll(numbers), ([match, whole = "", decimals = "", scale = ""]) => {
    const unit = scales.get(scale.toLowerCase()) ?? 1

    return {
      text: match,
      value: Number(`${whole.replaceAll(",", "")}.${decimals}0`) * unit,
      tolerance: 0.5 * 10 ** -decimals.length * unit,
    }
  })

const valuesOf = (summary: Summary) =>
  Match.valueTags(summary, {
    Lines: ({ lines: each }) =>
      each.flatMap((line) => [line.first, line.last, line.lowest, line.highest]),
    Bars: ({ bars: each, year }) => each.map(({ value }) => ({ year, value })),
    Dots: ({ dots, year }) =>
      dots.flatMap(({ value, against }) => [
        { year, value },
        { year, value: against },
      ]),
  })

const yearsOf = (summary: Summary) =>
  Match.valueTags(summary, {
    Lines: ({ from, to }) => [from, to],
    Bars: ({ year }) => [year],
    Dots: ({ year }) => [year],
  })

const namesOf = (summary: Summary) =>
  Match.valueTags(summary, {
    Lines: ({ name }) => [name],
    Bars: ({ name }) => [name],
    Dots: ({ name, against }) => [name, against],
  })

// Whether a written number comes from the data: a value or a year in the
// summary, rounded the way it is written, or a number in an indicator's name,
// such as the ages in "Unemployment, youth total (% of labor force ages 15-24)".
// A sign is not checked: "fell 3.2%" writes the value -3.2.
const fromData = (summary: Summary) => {
  const points = valuesOf(summary)
  const years = new Set<number>([...yearsOf(summary), ...points.map(({ year }) => year)])

  const named = new Set(
    namesOf(summary)
      .flatMap(writtenIn)
      .map(({ text }) => text),
  )

  return ({ text, value, tolerance }: Written) =>
    named.has(text) ||
    years.has(value) ||
    points.some((point) => Math.abs(Math.abs(point.value) - value) <= tolerance * (1 + 1e-9))
}

// The takeaway to show from what the model wrote, if any. Every number in it
// must come from the data the model was given; a takeaway with any other
// number, such as a difference the model worked out, is not shown. The answer
// shows plain text, so Markdown bold, which models write anyway, is removed.
export const check = (text: string, summary: Summary): Option.Option<string> => {
  const takeaway = text.replaceAll("**", "").trim()

  return takeaway !== "" && writtenIn(takeaway).every(fromData(summary))
    ? Option.some(takeaway)
    : Option.none()
}
