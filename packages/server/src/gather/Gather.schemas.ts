import { Source } from "@repo/domain"
import { Schema } from "effect"

// A run that left some sources ungathered: five consecutive asset failures
// stopped them, or a step failed. The other sources still ran, and the
// ledger keeps what each stored.
export class GatherFailed extends Schema.TaggedError<
  GatherFailed,
  { readonly brand: unique symbol }
>()("GatherFailed", { sources: Schema.Array(Source) }) {}
