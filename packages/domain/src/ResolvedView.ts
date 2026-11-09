import { Schema } from "effect"

import { Country } from "./Country.ts"
import { Dimension } from "./Dimension.ts"
import { Indicator, IndicatorId } from "./Indicator.ts"
import { Source } from "./Source.ts"
import { Change, Ranking, Relation, Trend, Year } from "./View.ts"

// How a source qualifies a value: provisional until its final release,
// estimated rather than measured, or the first after a break in series, when
// the source changed how it measures.
const Flag = Schema.Literals(["Provisional", "Estimated", "Break"])

export type Flag = typeof Flag.Type

// One value of an indicator, as the source published it or after a transform.
export const Observation = Schema.Struct({
  country: Country,
  year: Year,
  value: Schema.Finite,
  flags: Schema.optionalKey(Schema.NonEmptyArray(Flag)),
})

export interface Observation extends Schema.Schema.Type<typeof Observation> {}

// One series fetched to draw the chart, shown next to it. A transformed chart
// lists every series it was computed from, e.g. GDP and population.
const Provenance = Schema.Struct({
  indicator: IndicatorId,
  name: Schema.NonEmptyString,
  source: Source,
  dataset: Schema.NonEmptyString,
  url: Schema.String,
  retrievedAt: Schema.DateTimeUtc,
})

// Another source's values for what the chart shows, where they differ from
// the chart's by more than rounding. `source` is the series they came from.
const Disagreement = Schema.Struct({
  source: Provenance,
  observations: Schema.NonEmptyArray(Observation),
})

// What every resolved View holds: its indicator's values after the
// transform. `title` heads the chart: the indicator's plain-language title, or
// its official name when it has none; `indicator` keeps the official name.
// `missing` lists the requested countries with no value, so the chart can say
// so instead of dropping them. `dimensions` lists what else an SDMX
// indicator's series differ by, with the values the View can pick; it is
// empty for the World Bank, whose indicators are single series.
// `disagreements` lists the other sources whose values for the same figure
// differ.
const fields = {
  title: Schema.NonEmptyString,
  indicator: Indicator,
  observations: Schema.Array(Observation),
  missing: Schema.Array(Country),
  dimensions: Schema.Array(Dimension),
  disagreements: Schema.Array(Disagreement),
  sources: Schema.NonEmptyArray(Provenance),
}

// A Trend, Ranking or Change, with the data behind it.
const Single = Schema.Struct({ view: Schema.Union([Trend, Ranking, Change]), ...fields })

// A Relation also holds the values of the indicator it is plotted against.
// A country is missing unless it has a value for both.
const Paired = Schema.Struct({
  view: Relation,
  ...fields,
  against: Schema.Struct({
    title: Schema.NonEmptyString,
    indicator: Indicator,
    observations: Schema.Array(Observation),
  }),
})

export const ResolvedView = Schema.Union([Single, Paired])

export type ResolvedView = typeof ResolvedView.Type
