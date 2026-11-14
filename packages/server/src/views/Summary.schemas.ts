import { Country, Input, Qualification, Year } from "@repo/domain"
import { Schema } from "effect"

const Point = Schema.Struct({ year: Year, value: Schema.Finite })

export type Point = typeof Point.Type

// How the source qualifies the charted values: each break in series, by
// country and year, and how many values are provisional or estimated. A break
// means the source changed how it measures from that year, so a jump there
// may be the method rather than the world.
const Flagged = Schema.Struct({
  breaks: Schema.Array(Schema.Struct({ country: Country, year: Year })),
  provisional: Schema.Int,
  estimated: Schema.Int,
})

// Where one line of a trend or a change starts, ends, and is lowest and
// highest.
const Line = Schema.Struct({
  country: Country,
  first: Point,
  last: Point,
  lowest: Point,
  highest: Point,
})

const evidence = {
  missing: Schema.Array(Country),
  flagged: Flagged,
  qualifications: Schema.optionalKey(Schema.Array(Qualification)),
  inputs: Schema.optionalKey(Schema.UndefinedOr(Schema.NonEmptyArray(Input))),
}

export const Lines = Schema.TaggedStruct("Lines", {
  name: Schema.String,
  from: Year,
  to: Year,
  lines: Schema.Array(Line),
  ...evidence,
})

const Ranked = Schema.Array(Schema.Struct({ country: Country, value: Schema.Finite }))

// A ranking's values in its year, highest first. A ranking over time adds
// each country's values in the first and last years of its span, so the
// model can say how the comparison moved. `missing` lists the countries with
// no value in the year shown; `flagged` covers every year fetched, so a break
// in series inside the span is told.
export const Bars = Schema.TaggedStruct("Bars", {
  name: Schema.String,
  year: Year,
  bars: Ranked,
  span: Schema.optionalKey(
    Schema.Struct({
      from: Schema.Struct({ year: Year, bars: Ranked }),
      to: Schema.Struct({ year: Year, bars: Ranked }),
    }),
  ),
  ...evidence,
})

const Paired = Schema.Array(
  Schema.Struct({ country: Country, value: Schema.Finite, against: Schema.Finite }),
)

// A relation's dots in its year: each country's value of the indicator and of
// the one it is plotted against, named in `against`. A relation over time
// adds each country's dots in the first and last years of its span, so the
// model can say how the two measures moved together; `missing` and
// `flagged` read as a ranking's.
export const Dots = Schema.TaggedStruct("Dots", {
  name: Schema.String,
  against: Schema.String,
  year: Year,
  dots: Paired,
  span: Schema.optionalKey(
    Schema.Struct({
      from: Schema.Struct({ year: Year, dots: Paired }),
      to: Schema.Struct({ year: Year, dots: Paired }),
    }),
  ),
  ...evidence,
})

// What show_chart tells the model about the values it charted, so it can
// write about it: the indicator's official name, which carries its unit,
// the years the chart covers, and a trend's or a change's lines, a ranking's
// bars, or a relation's dots. `missing` lists the countries the chart has no
// value for, and `flagged` how the source qualifies the indicator's values.
export const Summary = Schema.Union([Lines, Bars, Dots])

export type Summary = typeof Summary.Type
