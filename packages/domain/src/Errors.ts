import { Schema } from "effect"

import { IndicatorId } from "./Indicator.ts"

export class IndicatorNotFound extends Schema.TaggedError<
  IndicatorNotFound,
  { readonly brand: unique symbol }
>()("IndicatorNotFound", { indicator: IndicatorId }, { httpApiStatus: 404 }) {}

// The source failed, timed out, or answered in a shape we do not recognize.
export class SourceUnavailable extends Schema.TaggedError<
  SourceUnavailable,
  { readonly brand: unique symbol }
>()("SourceUnavailable", { source: Schema.Literal("World Bank") }, { httpApiStatus: 502 }) {}
