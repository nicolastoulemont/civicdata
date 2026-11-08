import { Schema } from "effect"

import { IndicatorId } from "./Indicator.ts"

// One indicator a user can search for and switch to.
export const CatalogEntry = Schema.Struct({
  indicator: IndicatorId,
  name: Schema.NonEmptyString,
  definition: Schema.String,
})

export interface CatalogEntry extends Schema.Schema.Type<typeof CatalogEntry> {}

// What a user typed into indicator search. Two characters is the shortest
// prefix that narrows 1,500 indicators usefully.
export const SearchText = Schema.String.check(Schema.isMinLength(2))
