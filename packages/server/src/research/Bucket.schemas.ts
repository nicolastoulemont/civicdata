import { Schema } from "effect"

// R2 refused or failed a request for one object.
export class BucketUnavailable extends Schema.TaggedError<
  BucketUnavailable,
  { readonly brand: unique symbol }
>()("BucketUnavailable", {
  operation: Schema.String,
  key: Schema.String,
  problem: Schema.String,
}) {}
