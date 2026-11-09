import { Schema } from "effect"

import { Country } from "./Country.ts"
import { Indicator, IndicatorId } from "./Indicator.ts"
import { Source } from "./Source.ts"
import { Change, Ranking, Relation, Trend, Year } from "./View.ts"

// One value of an indicator, as the source published it or after a transform.
export const Observation = Schema.Struct({
  country: Country,
  year: Year,
  value: Schema.Finite,
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

// What every resolved View holds: its indicator's values after the
// transform. `title` heads the chart: the indicator's plain-language title, or
// its official name when it has none; `indicator` keeps the official name.
// `missing` lists the requested countries with no value, so the chart can say
// so instead of dropping them.
const fields = {
  title: Schema.NonEmptyString,
  indicator: Indicator,
  observations: Schema.Array(Observation),
  missing: Schema.Array(Country),
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
