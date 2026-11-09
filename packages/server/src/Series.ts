import {
  type Country,
  Indicator,
  type IndicatorId,
  Observation,
  type Year,
} from "@civicdata/domain"
import { Schema } from "effect"

// What the Resolver asks a source adapter for: one indicator's values for
// some countries and years.
export interface Query {
  readonly indicator: IndicatorId
  readonly countries: ReadonlyArray<Country>
  readonly from: Year
  readonly to: Year
}

// Every result records when its source was asked, so a cached result still
// reports its original retrieval time as provenance.
export const Described = Schema.Struct({
  indicator: Indicator,
  dataset: Schema.String,
  retrievedAt: Schema.DateTimeUtc,
})

export type Described = typeof Described.Type

export const Series = Schema.Struct({
  observations: Schema.Array(Observation),
  url: Schema.String,
  retrievedAt: Schema.DateTimeUtc,
})

export type Series = typeof Series.Type
