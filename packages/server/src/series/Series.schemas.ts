import { Dimension, Indicator, Input, Qualification, Observation } from "@repo/domain"
import { Schema } from "effect"

// Every result records when its source was asked, so a cached result still
// reports its original retrieval time as provenance.
export const Described = Schema.Struct({
  dimensions: Schema.optionalKey(Schema.Array(Dimension)),
  indicator: Indicator,
  dataset: Schema.String,
  retrievedAt: Schema.DateTimeUtc,
})

export type Described = typeof Described.Type

export const Series = Schema.Struct({
  inputs: Schema.optionalKey(Schema.UndefinedOr(Schema.NonEmptyArray(Input))),
  version: Schema.optionalKey(Schema.NonEmptyString),
  observations: Schema.Array(Observation),
  qualifications: Schema.optionalKey(Schema.Array(Qualification)),
  url: Schema.String,
  retrievedAt: Schema.DateTimeUtc,
})

export type Series = typeof Series.Type

// What a source answers for one series: its values, and what else the
// indicator's series differ by, with the values each dimension takes, so the
// page can offer the others. A World Bank indicator differs by none.
export const Answer = Schema.Struct({ ...Series.fields, dimensions: Schema.Array(Dimension) })

export type Answer = typeof Answer.Type
