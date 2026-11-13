import { Paper, Reading } from "@repo/domain"
import { Schema } from "effect"

import { Version } from "./store.schemas.ts"

// What a lookup found of one paper. Evidence is a passage of the version's
// active annotation, as the domain's Paper, which an answer may cite once
// Support accepts the sentence. A Reading is a paper search found that no
// annotation covers: its domain Reading, shown under the answer and never
// cited, and the version a demand records, or null for a paper the store
// holds only the bibliography of. An annotated paper whose annotation gives
// no passage for the question is neither.
export const Lead = Schema.TaggedUnion({
  Evidence: { paper: Paper },
  Reading: { reading: Reading, version: Schema.NullOr(Version.fields.id) },
})

// The leads of a lookup in search's order, or why it found none.
export const Found = Schema.TaggedUnion({
  Papers: { papers: Schema.NonEmptyArray(Lead) },
  NoEvidence: { reason: Schema.String },
})

export type Found = typeof Found.Type

// The paper store could not answer, or holds a paper whose citation does
// not decode.
export class LibraryUnavailable extends Schema.TaggedError<
  LibraryUnavailable,
  { readonly brand: unique symbol }
>()("LibraryUnavailable", { cause: Schema.Unknown }) {}
