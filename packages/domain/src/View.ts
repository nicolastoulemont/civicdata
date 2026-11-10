import { Match, Schema } from "effect"

import { Country } from "./Country.ts"
import { Dimensions } from "./Dimension.ts"
import { IndicatorId } from "./Indicator.ts"
import { Ratio, Transform } from "./Transform.ts"

// World Bank series start in 1960.
export const Year = Schema.Int.check(Schema.isBetween({ minimum: 1960, maximum: 2100 })).pipe(
  Schema.brand("Year"),
)

export type Year = typeof Year.Type

const Countries = Schema.NonEmptyArray(Country).check(Schema.isUnique())

const forwards = Schema.makeFilter(
  (years: { readonly from: Year; readonly to: Year }) =>
    years.from <= years.to || "from must not be after to",
)

// The years a chart over time moves through, both included. A chart that
// carries one shows its year with a slider over them; one without is static.
const Span = Schema.Struct({ from: Year, to: Year }).check(forwards)

export interface Span extends Schema.Schema.Type<typeof Span> {}

// A chart over time shows a year of its span.
const within = Schema.makeFilter(
  (view: { readonly year: Year; readonly span?: Span }) =>
    view.span === undefined ||
    (view.year >= view.span.from && view.year <= view.span.to) ||
    "year must lie inside span",
)

// A ratio of an indicator to itself is 1 everywhere.
const divides = Schema.makeFilter(
  (view: { readonly indicator: IndicatorId; readonly transform?: Transform }) =>
    view.transform === undefined ||
    Match.value(view.transform).pipe(
      Match.when({ _tag: "Ratio" }, (ratio) => ratio.per !== view.indicator),
      Match.orElse(() => true),
    ) ||
    "a ratio must divide by another indicator",
)

// One indicator for some countries over a range of years, drawn as lines.
export const Trend = Schema.TaggedStruct("Trend", {
  indicator: IndicatorId,
  countries: Countries,
  from: Year,
  to: Year,
  transform: Schema.optionalKey(Transform),
  dimensions: Schema.optionalKey(Dimensions),
}).check(forwards, divides)

export interface Trend extends Schema.Schema.Type<typeof Trend> {}

// One indicator for some countries in a single year, drawn as ranked bars,
// or as a map when `as` is "Map": of the first region in `regions` that holds
// every country, else of the world. A ranking with a span moves through its
// years, showing `year`; a map of one year is shaded by rank, one over time by
// value. A ranking has no first year to index to.
export const Ranking = Schema.TaggedStruct("Ranking", {
  indicator: IndicatorId,
  countries: Countries,
  year: Year,
  span: Schema.optionalKey(Span),
  as: Schema.optionalKey(Schema.Literal("Map")),
  transform: Schema.optionalKey(Schema.Union([Schema.Literals(["PerPerson", "Growth"]), Ratio])),
  dimensions: Schema.optionalKey(Dimensions),
}).check(divides, within)

// One indicator for some countries in two years, drawn as a dot for each year
// joined by a line. Growth and an index describe a change already, so only
// "per person" and a ratio apply.
export const Change = Schema.TaggedStruct("Change", {
  indicator: IndicatorId,
  countries: Countries,
  from: Year,
  to: Year,
  transform: Schema.optionalKey(Schema.Union([Schema.Literal("PerPerson"), Ratio])),
  dimensions: Schema.optionalKey(Dimensions),
}).check(forwards, divides)

export interface Change extends Schema.Schema.Type<typeof Change> {}

// One indicator against another for some countries in a single year, drawn
// as a dot per country: `indicator` up the side, `against` along the bottom.
// `dimensions` picks the series of `indicator`.
export const Relation = Schema.TaggedStruct("Relation", {
  indicator: IndicatorId,
  against: IndicatorId,
  countries: Countries,
  year: Year,
  dimensions: Schema.optionalKey(Dimensions),
}).check(
  Schema.makeFilter(
    (relation) => relation.indicator !== relation.against || "against must be another indicator",
  ),
)

export interface Relation extends Schema.Schema.Type<typeof Relation> {}

// The state of a chart: what to fetch and how to draw it.
export const View = Schema.Union([Trend, Ranking, Change, Relation])

export type View = typeof View.Type

// The transform a View applies to its indicator's values, if any. A relation
// takes none.
export const transformOf = (view: View) =>
  Match.value(view).pipe(
    Match.tag("Relation", () => undefined),
    Match.orElse((single) => single.transform),
  )
