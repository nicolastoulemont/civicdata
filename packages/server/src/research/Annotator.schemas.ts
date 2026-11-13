import { Schema } from "effect"

const Tokens = Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))

// What one model call cost: its requests and the tokens the provider
// reported, or null where it reported none.
export const Usage = Schema.Struct({ requests: Schema.Int, input: Tokens, output: Tokens })

export interface Usage extends Schema.Schema.Type<typeof Usage> {}

// The model answered, but not as the contract asks: malformed output, an
// unknown sentence, an ungrounded quote, or missing or duplicate labels.
// Asking again is a new attempt, not a retry.
export class AnnotationInvalid extends Schema.TaggedError<
  AnnotationInvalid,
  { readonly brand: unique symbol }
>()("AnnotationInvalid", { problem: Schema.String }) {}

// The provider did not answer: a network failure, an error status or a
// timeout. Asking again may succeed.
export class ProviderFailed extends Schema.TaggedError<
  ProviderFailed,
  { readonly brand: unique symbol }
>()("ProviderFailed", { problem: Schema.String }) {}
