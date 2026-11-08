import { Schema } from "effect"

import { IndicatorId } from "./Indicator.ts"
import { Transform } from "./Transform.ts"

export class IndicatorNotFound extends Schema.TaggedError<
  IndicatorNotFound,
  { readonly brand: unique symbol }
>()("IndicatorNotFound", { indicator: IndicatorId }, { httpApiStatus: 404 }) {}

// The source failed, timed out, or answered in a shape we do not recognize.
export class SourceUnavailable extends Schema.TaggedError<
  SourceUnavailable,
  { readonly brand: unique symbol }
>()("SourceUnavailable", { source: Schema.Literal("World Bank") }, { httpApiStatus: 502 }) {}

// The catalog cannot be searched in this runtime, e.g. plain `pnpm dev` outside Workers.
export class CatalogUnavailable extends Schema.TaggedError<
  CatalogUnavailable,
  { readonly brand: unique symbol }
>()("CatalogUnavailable", {}, { httpApiStatus: 503 }) {}

// The View asks for a transform its indicator's values cannot take, e.g. a
// percentage per person.
export class TransformNotApplicable extends Schema.TaggedError<
  TransformNotApplicable,
  { readonly brand: unique symbol }
>()(
  "TransformNotApplicable",
  { indicator: IndicatorId, transform: Transform },
  { httpApiStatus: 422 },
) {}
