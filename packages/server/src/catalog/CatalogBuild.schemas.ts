import { Source } from "@repo/domain"
import { Schema } from "effect"

// A build that left some sources on their previous generation.
export class BuildFailed extends Schema.TaggedError<
  BuildFailed,
  { readonly brand: unique symbol }
>()("BuildFailed", {
  sources: Schema.Array(Source),
}) {}
