import { Schema } from "effect"

import { Digest, Work } from "./archive.schemas.ts"
import { Reason } from "./store.schemas.ts"

// What the app charts, which each topic serves.
const Area = Schema.Literals([
  "labour",
  "prices",
  "growth",
  "public-finance",
  "pensions",
  "inequality",
  "health",
  "education",
  "emissions-energy",
  "democracy",
])

// One OpenAlex search: its words, and whether it keeps to EconStor's
// repository copies.
export const Topic = Schema.Struct({
  area: Area,
  query: Schema.NonEmptyString,
  repository: Schema.optional(Schema.Boolean),
})

export interface Topic extends Schema.Schema.Type<typeof Topic> {}

// What the gather did with one work, as the ledger records it.
export const Outcome = Schema.TaggedUnion({
  // The store serves text from an admitted copy.
  Text: { paper: Digest, version: Digest },
  // The store keeps only the bibliography, with why.
  Metadata: { paper: Digest, reason: Reason },
  // Another paper of the store, a hand-audited copy from `papers:intake`,
  // already holds this work; the gather leaves it alone.
  Covered: { paper: Digest },
  // The store refused the work's rows, such as metadata for a paper whose
  // text it serves. Nothing changes until the record does.
  Refused: { paper: Digest, problem: Schema.String },
  // Every copy worth downloading that the gather tried failed, or the store
  // failed. The next run tries again, up to `attempts` times on one record.
  Failed: { operation: Schema.String, problem: Schema.String },
})

export type Outcome = typeof Outcome.Type

export const Gathered = Schema.Struct({
  work: Work.fields.id,
  title: Schema.String,
  outcome: Outcome,
})
