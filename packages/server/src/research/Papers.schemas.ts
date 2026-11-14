import { Withdrawal } from "@repo/domain"
import { Schema } from "effect"

import { Passage } from "./archive.schemas.ts"
import { Bibliography, Body, Holding, PaperId, Reason, Version } from "./store.schemas.ts"

// What the store holds for a paper: its text through its active version, or
// only its bibliography and why it has no text.
export const Held = Schema.TaggedUnion({
  Text: {
    paper: Bibliography,
    copy: Holding,
    version: Version,
    passages: Schema.NonEmptyArray(Passage),
    // The version's active annotation, if one is ready.
    annotation: Schema.NullOr(Body),
  },
  Metadata: { paper: Bibliography, reason: Reason },
  Withdrawn: { paper: Bibliography, reason: Withdrawal },
})

export type Held = typeof Held.Type

// No published paper has this id. A paper whose publication has not set an
// active version, a metadata reason or a withdrawal is not published yet.
export class PaperMissing extends Schema.TaggedError<
  PaperMissing,
  { readonly brand: unique symbol }
>()("PaperMissing", { paper: PaperId }) {}

// The store holds the paper but not what its rows promise: a text object that
// is missing, has another hash or does not decode, or a row that does not.
export class PaperCorrupt extends Schema.TaggedError<
  PaperCorrupt,
  { readonly brand: unique symbol }
>()("PaperCorrupt", { paper: PaperId, cause: Schema.Defect() }) {}

// The store could not answer: D1 or R2 failed, a table is missing, or the
// Worker binds no store.
export class PapersUnavailable extends Schema.TaggedError<
  PapersUnavailable,
  { readonly brand: unique symbol }
>()("PapersUnavailable", { cause: Schema.Defect() }) {}
