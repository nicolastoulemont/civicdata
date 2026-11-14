import { Schema, Struct } from "effect"

import { Annotation } from "./annotation.schemas.ts"
import {
  Content,
  Digest,
  Evidence,
  Copy as Location,
  Passage,
  Seed,
  Work,
} from "./archive.schemas.ts"

export const PaperId = Digest.pipe(Schema.brand("PaperId"))

export type PaperId = typeof PaperId.Type

// What a paper is, whether or not any copy of it has text we may show.
export const Bibliography = Schema.Struct({
  id: PaperId,
  openalex: Seed.fields.openalex,
  study: Seed.fields.study,
  work: Schema.NullOr(Work),
  metadataUrl: Schema.NullOr(Schema.String),
  retrievedAt: Schema.String,
})

export interface Bibliography extends Schema.Schema.Type<typeof Bibliography> {}

// Why a paper has no text: the reason the gather kept only its metadata.
export const Reason = Content.cases.Metadata.fields.reason

export type Reason = typeof Reason.Type

// One exact copy the store holds: the location it came from, under that
// location's licence and source version, with the evidence that admitted it.
export const Holding = Schema.Struct({
  id: Digest,
  location: Location,
  evidence: Schema.Array(Evidence),
})

// One extraction of an admitted copy's PDF. Its objects sit at `objectsOf`
// its id; `text` hashes the text object's bytes.
export const Version = Schema.Struct({
  id: Digest,
  extraction: Schema.NonEmptyString,
  url: Schema.String,
  pdf: Digest,
  text: Digest,
  pages: Passage.fields.page,
  emptyPages: Schema.Array(Passage.fields.page),
})

export interface Version extends Schema.Schema.Type<typeof Version> {}

// What a version's text object holds: its passages, in page order.
export const Text = Schema.fromJsonString(Schema.NonEmptyArray(Passage))

// An annotation of one text, without the stamp that tied it to a paper: the
// key does that, and copies with the same text share it.
export const Body = Annotation.mapFields(Struct.omit(["stamp"]))

export interface Body extends Schema.Schema.Type<typeof Body> {}
