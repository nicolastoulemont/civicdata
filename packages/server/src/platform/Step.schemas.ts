import { Schema } from "effect"

// A step that still failed after its retries.
export class StepFailed extends Schema.TaggedError<StepFailed, { readonly brand: unique symbol }>()(
  "StepFailed",
  {
    step: Schema.String,
    cause: Schema.Defect(),
  },
) {}
