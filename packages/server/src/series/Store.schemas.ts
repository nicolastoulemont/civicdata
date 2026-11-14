import { Dimensions, Input, Qualification, Observation } from "@repo/domain"
import { Schema } from "effect"

import { Described } from "./Series.schemas.ts"
import { coherent } from "./utils/coherent.ts"

// One stored series: its values for every country and year we chart, what
// the source calls its indicator, the value of each of its dimensions, when
// the source was asked, and the source's own date for the release the values
// came from, such as the World Development Indicators' last update.
export const Stored = Schema.Struct({
  ...Described.fields,
  dimensions: Dimensions,
  version: Schema.NonEmptyString,
  observations: Schema.Array(Observation),
  inputs: Schema.optionalKey(Schema.UndefinedOr(Schema.NonEmptyArray(Input))),
  qualifications: Schema.optionalKey(Schema.Array(Qualification)),
}).check(Schema.makeFilter(coherent))

export interface Stored extends Schema.Schema.Type<typeof Stored> {}
