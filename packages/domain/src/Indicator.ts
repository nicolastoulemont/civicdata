import { Schema } from "effect"

// A source's own indicator code, such as the World Bank's "SP.POP.TOTL".
export const IndicatorId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
).pipe(Schema.brand("IndicatorId"))

export type IndicatorId = typeof IndicatorId.Type

export const Indicator = Schema.Struct({
  id: IndicatorId,
  name: Schema.NonEmptyString,
  definition: Schema.String,
})
