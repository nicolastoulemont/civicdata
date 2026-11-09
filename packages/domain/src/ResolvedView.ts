import { Schema } from "effect"

import { Country } from "./Country.ts"
import { Indicator, IndicatorId } from "./Indicator.ts"
import { View, Year } from "./View.ts"

const Observation = Schema.Struct({
  country: Country,
  year: Year,
  value: Schema.Finite,
})

// One series fetched to draw the chart, shown next to it. A transformed chart
// lists every series it was computed from, e.g. GDP and population.
const Provenance = Schema.Struct({
  indicator: IndicatorId,
  source: Schema.Literal("World Bank"),
  dataset: Schema.NonEmptyString,
  url: Schema.String,
  retrievedAt: Schema.DateTimeUtc,
})

// A View with the data behind it, after its transform. `title` heads the
// chart: the indicator's plain-language title, or its official name when it
// has none; `indicator` keeps the official name. `missing` lists the
// requested countries with no value, so the chart can say so instead of
// dropping them.
export const ResolvedView = Schema.Struct({
  view: View,
  title: Schema.NonEmptyString,
  indicator: Indicator,
  observations: Schema.Array(Observation),
  missing: Schema.Array(Country),
  sources: Schema.NonEmptyArray(Provenance),
})

export interface ResolvedView extends Schema.Schema.Type<typeof ResolvedView> {}
