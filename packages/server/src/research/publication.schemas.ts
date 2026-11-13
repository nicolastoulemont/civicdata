import { Schema } from "effect"

// The store refuses what a record asks: text for a paper the record lists
// as metadata-only while the store still serves its text (withdraw it
// first), a copy the store holds for another paper, or other text under an
// extraction the store already holds.
export class Refused extends Schema.TaggedError<Refused, { readonly brand: unique symbol }>()(
  "Refused",
  { problem: Schema.String },
) {}

// An object R2 holds after an upload differs from the bytes sent.
export class ObjectMismatch extends Schema.TaggedError<
  ObjectMismatch,
  { readonly brand: unique symbol }
>()("ObjectMismatch", { key: Schema.String }) {}
