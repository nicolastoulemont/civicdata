import { Schema } from "effect"

// The model could not classify a batch: it is down, refused the request, or
// answered something that is not a Decisions response.
export class ClassifierUnavailable extends Schema.TaggedError<
  ClassifierUnavailable,
  { readonly brand: unique symbol }
>()("ClassifierUnavailable", { cause: Schema.Defect() }) {}
