import { Schema } from "effect"

import { Country } from "./Country.ts"
import { IndicatorId } from "./Indicator.ts"
import { Transform } from "./Transform.ts"

// World Bank series start in 1960.
export const Year = Schema.Int.check(Schema.isBetween({ minimum: 1960, maximum: 2100 })).pipe(
  Schema.brand("Year"),
)

export type Year = typeof Year.Type

const Countries = Schema.NonEmptyArray(Country).check(Schema.isUnique())

// One indicator for some countries over a range of years, drawn as lines.
export const Trend = Schema.TaggedStruct("Trend", {
  indicator: IndicatorId,
  countries: Countries,
  from: Year,
  to: Year,
  transform: Schema.optionalKey(Transform),
}).check(Schema.makeFilter((trend) => trend.from <= trend.to || "from must not be after to"))

export interface Trend extends Schema.Schema.Type<typeof Trend> {}

// One indicator for some countries in a single year, drawn as ranked bars.
// A single year has no first year to index to.
export const Ranking = Schema.TaggedStruct("Ranking", {
  indicator: IndicatorId,
  countries: Countries,
  year: Year,
  transform: Schema.optionalKey(Schema.Literals(["PerPerson", "Growth"])),
})

// The state of a chart: what to fetch and how to draw it.
export const View = Schema.Union([Trend, Ranking])

export type View = typeof View.Type
