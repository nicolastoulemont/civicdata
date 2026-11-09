import { Schema } from "effect"

import { Dimension, DimensionId } from "./Dimension.ts"
import { IndicatorId } from "./Indicator.ts"
import { Source } from "./Source.ts"
import { Transform } from "./Transform.ts"

export class IndicatorNotFound extends Schema.TaggedError<
  IndicatorNotFound,
  { readonly brand: unique symbol }
>()("IndicatorNotFound", { indicator: IndicatorId }, { httpApiStatus: 404 }) {}

// The source failed, timed out, or answered in a shape we do not recognize.
export class SourceUnavailable extends Schema.TaggedError<
  SourceUnavailable,
  { readonly brand: unique symbol }
>()("SourceUnavailable", { source: Source }, { httpApiStatus: 502 }) {}

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

// The View leaves some dimensions of an SDMX dataflow open, such as sex or
// age, or picks a value they do not take, so it matches no single series.
// `dimensions` lists every dimension the View picks a value of, with the
// values each takes; `open` names the ones it still has to pick.
export class DimensionsMissing extends Schema.TaggedError<
  DimensionsMissing,
  { readonly brand: unique symbol }
>()(
  "DimensionsMissing",
  {
    indicator: IndicatorId,
    dimensions: Schema.Array(Dimension),
    open: Schema.NonEmptyArray(DimensionId),
  },
  { httpApiStatus: 422 },
) {}

// The language model failed, refused, or is not configured in this runtime.
export class AgentUnavailable extends Schema.TaggedError<
  AgentUnavailable,
  { readonly brand: unique symbol }
>()("AgentUnavailable", {}, { httpApiStatus: 503 }) {}

// One visitor asked more questions in a minute than a deployment allows.
export class TooManyQuestions extends Schema.TaggedError<
  TooManyQuestions,
  { readonly brand: unique symbol }
>()("TooManyQuestions", {}, { httpApiStatus: 429 }) {}

// The conversation is still answering an earlier question, e.g. asked from
// another tab. Its history is kept in order, one question at a time.
export class ConversationBusy extends Schema.TaggedError<
  ConversationBusy,
  { readonly brand: unique symbol }
>()("ConversationBusy", {}, { httpApiStatus: 409 }) {}

// The conversation has no turn at this place, e.g. one not answered yet.
export class TurnNotFound extends Schema.TaggedError<
  TurnNotFound,
  { readonly brand: unique symbol }
>()("TurnNotFound", { turn: Schema.Int }, { httpApiStatus: 404 }) {}

// The turn did not end with a chart: the agent asked back, found no
// indicator, or was stopped.
export class NoChart extends Schema.TaggedError<NoChart, { readonly brand: unique symbol }>()(
  "NoChart",
  { turn: Schema.Int },
  { httpApiStatus: 409 },
) {}

// No elections or governments can be read in this runtime: outside Workers,
// or before the scheduled build first stores them.
export class PoliticsUnavailable extends Schema.TaggedError<
  PoliticsUnavailable,
  { readonly brand: unique symbol }
>()("PoliticsUnavailable", {}, { httpApiStatus: 503 }) {}
