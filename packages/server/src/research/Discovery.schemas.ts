import { Schema } from "effect"

import { Passage } from "./archive.schemas.ts"
import { Bibliography, Holding, Reason, Version } from "./store.schemas.ts"

// A paper the store holds that a query's words found, for discovery only: it
// is not evidence and carries no citation. A match with text has the version
// it was read from, whether that version has an annotation, and up to three
// of its passages the words found, best first, each on its physical page. A
// metadata-only match has the bibliography alone and never a passage.
export const Match = Schema.TaggedUnion({
  Text: {
    paper: Bibliography,
    copy: Holding,
    version: Version,
    annotated: Schema.Boolean,
    excerpts: Schema.Array(Passage),
  },
  Metadata: { paper: Bibliography, reason: Reason },
})

export type Match = typeof Match.Type

// A query search refuses: it has no word to search for once common words are
// dropped, or more text or words than a query needs.
export class QueryInvalid extends Schema.TaggedError<
  QueryInvalid,
  { readonly brand: unique symbol }
>()("QueryInvalid", { reason: Schema.Literals(["Empty", "Long"]) }) {}
