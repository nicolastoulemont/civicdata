import { Failure } from "@repo/domain"
import { Schema } from "effect"

import { AssetId } from "./Adapter.schemas.ts"

// Why an asset failed: what its source did, or something on our side, such
// as the store, the database, or a Workflow step that lost its error's type.
export const Internal = Schema.TaggedStruct("Internal", {})

const Reason = Schema.Union([Failure, Internal])

export type Reason = typeof Reason.Type

// Kept as a tagged union so later policies can add an Unstorable decision.
// A failure recorded before reasons were classified holds a string, which
// never starts a backoff.
export const Gathered = Schema.TaggedUnion({
  Stored: { version: Schema.String, at: Schema.DateTimeUtcFromString },
  Failed: {
    wanted: Schema.String,
    stored: Schema.OptionFromNullOr(Schema.String),
    failures: Schema.Int,
    reason: Schema.Union([Reason, Schema.String]),
    at: Schema.DateTimeUtcFromString,
  },
})

export const GatheredJson = Schema.fromJsonString(Gathered)

// An asset a run still wants, at the version it wants, with what the ledger
// last recorded for it.
export const Wanted = Schema.Struct({
  asset: AssetId,
  version: Schema.NonEmptyString,
  state: Schema.OptionFromNullOr(GatheredJson),
})

export interface Wanted extends Schema.Schema.Type<typeof Wanted> {}
