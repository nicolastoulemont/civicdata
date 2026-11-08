import { Schema } from "effect"

import { Country } from "./Country.ts"
import { Indicator } from "./Indicator.ts"
import { View, Year } from "./View.ts"

const Observation = Schema.Struct({
  country: Country,
  year: Year,
  value: Schema.Finite,
})

// Where the observations came from, shown next to every chart.
const Provenance = Schema.Struct({
  source: Schema.Literal("World Bank"),
  dataset: Schema.NonEmptyString,
  url: Schema.String,
  retrievedAt: Schema.DateTimeUtc,
})

// A View with the data behind it. `missing` lists the requested countries the
// source has no value for, so the chart can say so instead of dropping them.
export const ResolvedView = Schema.Struct({
  view: View,
  indicator: Indicator,
  observations: Schema.Array(Observation),
  missing: Schema.Array(Country),
  provenance: Provenance,
})

export interface ResolvedView extends Schema.Schema.Type<typeof ResolvedView> {}
