import { Text } from "@repo/domain"
import { Schema } from "effect"

export const Verdict = Schema.TaggedUnion({
  NotResearch: {},
  Supported: {
    kind: Schema.Literals(["Description", "Association", "Cause"]),
    evidence: Schema.Array(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).check(
      Schema.isMinLength(1),
    ),
  },
  Unsupported: {},
  Uncertain: {},
})

export const Checked = Schema.TaggedUnion({
  Accepted: { text: Text },
  Rejected: { reason: Schema.String },
})

export class SupportUnavailable extends Schema.TaggedError<
  SupportUnavailable,
  { readonly brand: unique symbol }
>()("SupportUnavailable", { cause: Schema.Unknown }) {}
