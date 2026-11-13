import { Effect, Schema, Struct } from "effect"
import { SqlClient } from "effect/sql"

import { fingerprint } from "../fingerprint.ts"
import { Annotation } from "./annotation.ts"
import { Content, Digest, Evidence, Copy as Location, Passage, Seed, Work } from "./archive.ts"

// The paper store: PAPERS_DB holds what search and annotation query, the
// PAPERS bucket each version's PDF and extracted text. docs/papers.md
// describes both and who writes them.

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

// Whether a copy's text may be stored and shown. Only an Admitted copy has
// versions. Withdrawn is a copy that was admitted until rights or a
// retraction removed its text.
export type Admission = "Admitted" | "Restricted" | "Retracted" | "Unidentified" | "Withdrawn"

export const Withdrawal = Schema.Literals(["Rights", "Retraction"])

export type Withdrawal = typeof Withdrawal.Type

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

// What an annotation is of and by: the text's SHA-256, its extraction, the
// model and the rubric. Copy identity stays out, so copies with the same
// text share one annotation.
export const annotationKey = (key: {
  readonly text: string
  readonly extraction: string
  readonly model: string
  readonly rubric: string
}) => fingerprint(JSON.stringify([key.text, key.extraction, key.model, key.rubric]))

// Where a version's PDF and text live in the PAPERS bucket.
export const objectsOf = (version: string) => ({
  pdf: `version/${version}/paper.pdf`,
  text: `version/${version}/text.json`,
})

// The store's tables. Only writers run this: the publication command and the
// annotation Workflow. A reader never creates one (built.ts says why).
//
// The constraints carry the store's rules, so a writer cannot break them:
// - A paper shows text only through `active`, a version of one of its own
//   copies, which a writer sets after the version, its passages and its
//   objects are in place.
// - A version references its copy with `admission`, which can only be
//   Admitted: a copy that is not has no version, and a copy keeps its
//   admission while it has one. Withdrawing a copy deletes its versions
//   first, and its passages go with them.
// - A version points to its active annotation only if that annotation is of
//   its text and extraction.
// - A paper with a metadata-only reason has no active version.
export const tables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE IF NOT EXISTS paper (
    id TEXT PRIMARY KEY,
    openalex TEXT,
    study TEXT NOT NULL CHECK (json_valid(study)),
    work TEXT CHECK (work IS NULL OR json_valid(work)),
    metadata_url TEXT,
    retrieved_at TEXT NOT NULL,
    reason TEXT,
    active TEXT,
    CHECK (reason IS NULL OR active IS NULL),
    FOREIGN KEY (active, id) REFERENCES version (id, paper)
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS copy (
    id TEXT PRIMARY KEY,
    paper TEXT NOT NULL REFERENCES paper (id),
    location TEXT NOT NULL CHECK (json_valid(location)),
    evidence TEXT NOT NULL CHECK (json_valid(evidence)),
    admission TEXT NOT NULL
      CHECK (admission IN ('Admitted', 'Restricted', 'Retracted', 'Unidentified', 'Withdrawn')),
    withdrawal TEXT CHECK (withdrawal IN ('Rights', 'Retraction')),
    CHECK ((admission = 'Withdrawn') = (withdrawal IS NOT NULL)),
    CHECK (admission <> 'Admitted' OR json_array_length(evidence) > 0),
    UNIQUE (id, paper, admission)
  )`

  yield* sql`CREATE INDEX IF NOT EXISTS copy_paper ON copy (paper)`

  yield* sql`CREATE TABLE IF NOT EXISTS annotation (
    key TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    extraction TEXT NOT NULL,
    model TEXT NOT NULL,
    rubric TEXT NOT NULL,
    body TEXT NOT NULL CHECK (json_valid(body)),
    created_at TEXT NOT NULL,
    UNIQUE (key, text, extraction),
    UNIQUE (text, extraction, model, rubric)
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS version (
    id TEXT PRIMARY KEY,
    paper TEXT NOT NULL,
    copy TEXT NOT NULL,
    admission TEXT NOT NULL DEFAULT 'Admitted' CHECK (admission = 'Admitted'),
    extraction TEXT NOT NULL,
    url TEXT NOT NULL,
    pdf TEXT NOT NULL,
    text TEXT NOT NULL,
    pages INTEGER NOT NULL,
    empty_pages TEXT NOT NULL CHECK (json_valid(empty_pages)),
    annotation TEXT,
    UNIQUE (id, paper),
    FOREIGN KEY (copy, paper, admission) REFERENCES copy (id, paper, admission),
    FOREIGN KEY (annotation, text, extraction) REFERENCES annotation (key, text, extraction)
  )`

  yield* sql`CREATE INDEX IF NOT EXISTS version_copy ON version (copy, paper, admission)`

  yield* sql`CREATE TABLE IF NOT EXISTS passage (
    version TEXT NOT NULL REFERENCES version (id) ON DELETE CASCADE,
    page INTEGER NOT NULL,
    part INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (version, page, part)
  )`
})
