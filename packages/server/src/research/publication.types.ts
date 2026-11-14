import { Data, type Schema } from "effect"
import type { SqlError } from "effect/sql"

import type { Annotation } from "./annotation.schemas.ts"
import type { Paper } from "./archive.schemas.ts"
import type { BucketUnavailable } from "./Bucket.schemas.ts"
import type { Document } from "./entry.schemas.ts"
import type { ObjectMismatch, Refused } from "./publication.schemas.ts"

// One gathered paper: its metadata alone, or its retained copy's text with
// that copy's PDF and the saved annotation that still fits it, if any.
export type Record = Data.TaggedEnum<{
  Metadata: { readonly paper: Paper }
  Text: {
    readonly paper: Document
    readonly pdf: Uint8Array
    readonly annotation: typeof Annotation.Type | null
  }
}>

export const Record = Data.taggedEnum<Record>()

// What writing one paper did.
type Published = Data.TaggedEnum<{
  Unchanged: {}
  Written: { readonly version: string | null; readonly annotation: string | null }
}>

export const Published = Data.taggedEnum<Published>()

// Why one paper was not published. The store keeps what it held.
export type Failure =
  | Refused
  | ObjectMismatch
  | BucketUnavailable
  | SqlError.SqlError
  | Schema.SchemaError
