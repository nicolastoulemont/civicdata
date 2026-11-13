import { Schema } from "effect"

// Workers AI or Vectorize failed, or answered in a shape we do not recognize.
export class VectorsUnavailable extends Schema.TaggedError<
  VectorsUnavailable,
  { readonly brand: unique symbol }
>()("VectorsUnavailable", { cause: Schema.Unknown }) {}
