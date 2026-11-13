import { D1Client } from "@effect/sql-d1"
import { Paper, Year } from "@repo/domain"
import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import type { NonEmptyReadonlyArray } from "effect/Array"
import { SqlClient } from "effect/sql"

import { fingerprint } from "../src/fingerprint.ts"
import { Scope } from "../src/research/annotation.ts"
import { Evidence, type Passage } from "../src/research/archive.ts"
import {
  type Admission,
  annotationKey,
  Bibliography,
  Body,
  objectsOf,
  PaperId,
  type Reason,
  tables,
  type Withdrawal,
} from "../src/research/store.ts"

export const paper = () =>
  Paper.make({
    id: "a".repeat(64),
    study: {
      authors: ["Example, Anne"],
      year: 2024,
      title: "Employment and training in France",
      publisher: "Example University",
      doi: "10.1234/training",
      url: "https://example.org/training.pdf",
    },
    population: "Working-age adults in France",
    quote: "Training participation was associated with higher employment.",
    kind: "Association",
    design: "Association",
    countries: ["FRA"],
    periods: [{ from: Year.make(2010), to: Year.make(2020) }],
    page: 4,
    url: "https://example.org/training.pdf#page=4",
    sha256: "b".repeat(64),
    version: "publishedVersion",
    licences: ["https://creativecommons.org/licenses/by/4.0/"],
    context: [
      { page: 5, text: "Selection into training may explain the association.", role: "Limitation" },
    ],
  })

// The paper store as its writers fill it (src/research/store.ts), valid by
// default. A test passes only the parts it asserts on.

const PapersDb = env.PAPERS_DB
const bucket = env.PAPERS

if (PapersDb === undefined || bucket === undefined)
  throw new Error("vitest.config.ts must bind PAPERS_DB and PAPERS")

// The test's PAPERS bucket, for a reader or writer under test.
export const papersBucket = bucket

// The test's PAPERS_DB, for builders and for a reader under test.
export const papersDb = D1Client.layer({ db: PapersDb }).pipe(Layer.orDie)

const licence = "https://creativecommons.org/licenses/by/4.0/"
const retrievedAt = "2026-11-01T00:00:00.000Z"

export const bibliography = (delta: Partial<Bibliography> = {}): Bibliography =>
  Bibliography.make({
    id: PaperId.make("c".repeat(64)),
    openalex: "https://openalex.org/W1",
    study: {
      authors: ["Example, Anne"],
      year: 2024,
      title: "Employment and training in France",
      publisher: "Example University",
      doi: "10.1234/training",
      url: "https://example.org/training.pdf",
    },
    work: null,
    metadataUrl: null,
    retrievedAt,
    ...delta,
  })

export const passages = (): NonEmptyReadonlyArray<typeof Passage.Type> => [
  { page: 1, part: 0, text: "Training participation rose in France between 2010 and 2020." },
  { page: 4, part: 0, text: "Training participation was associated with higher employment." },
]

export const body = (text: NonEmptyReadonlyArray<typeof Passage.Type> = passages()): Body =>
  Body.make({
    scope: {
      population: null,
      excerpts: [],
      countries: [],
      regions: [],
      periods: [],
      design: Scope.fields.design.cases.Unknown.make({}),
    },
    labels: text.map(({ page, part }) => ({ page, part, category: "Other", confidence: 1 })),
    excerpts: [],
  })

const location = (entry: Bibliography) => ({
  id: "https://openalex.org/locations/1",
  doi: entry.study.doi,
  raw_source_name: entry.study.publisher,
  landing_page_url: null,
  pdf_url: entry.study.url,
  license: "cc-by",
  version: "publishedVersion" as const,
})

const write = (entry: Bibliography, reason: Reason | null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* tables
    yield* sql`INSERT INTO paper (id, openalex, study, work, metadata_url, retrieved_at, reason)
      VALUES (${entry.id}, ${entry.openalex}, ${JSON.stringify(entry.study)},
        ${entry.work === null ? null : JSON.stringify(entry.work)}, ${entry.metadataUrl},
        ${entry.retrievedAt}, ${reason})`
  })

const copyOf = (entry: Bibliography, admission: Admission, withdrawal: Withdrawal | null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const id = yield* fingerprint(`${entry.id}|copy`)

    yield* sql`INSERT INTO copy (id, paper, location, evidence, admission, withdrawal)
      VALUES (${id}, ${entry.id}, ${JSON.stringify(location(entry))},
        ${JSON.stringify([
          Evidence.cases.Pdf.make({
            url: entry.study.url,
            sha256: "d".repeat(64),
            page: 1,
            licence,
            retrievedAt,
          }),
        ])},
        ${admission}, ${withdrawal})`

    return id
  })

interface Published {
  readonly paper?: Bibliography
  readonly passages?: NonEmptyReadonlyArray<typeof Passage.Type>
  // The version's active annotation, or none.
  readonly annotation?: Body | null
  // The bytes stored as the version's text object, when a test needs them
  // to differ from its passages.
  readonly object?: string | null
}

// A paper with an admitted copy and an active version: its rows, its
// passages, its text object and its annotation, in the order a writer must
// follow, the active pointer last.
export const publish = ({
  paper: entry = bibliography(),
  passages: text = passages(),
  annotation = body(text),
  object,
}: Published = {}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const extraction = "unpdf-2.1.0/300-words"
    const json = JSON.stringify(text)
    const sha = yield* fingerprint(json)

    yield* write(entry, null)
    const copy = yield* copyOf(entry, "Admitted", null)
    const version = yield* fingerprint(`${copy}|${extraction}`)

    const key =
      annotation === null
        ? null
        : yield* annotationKey({ text: sha, extraction, model: "gpt-6-luna", rubric: "research-3" })

    if (key !== null)
      yield* sql`INSERT INTO annotation (key, text, extraction, model, rubric, body, created_at)
        VALUES (${key}, ${sha}, ${extraction}, 'gpt-6-luna', 'research-3',
          ${JSON.stringify(annotation)}, ${retrievedAt})
        ON CONFLICT (key) DO NOTHING`

    yield* sql`INSERT INTO version (id, paper, copy, extraction, url, pdf, text, pages, empty_pages,
        annotation)
      VALUES (${version}, ${entry.id}, ${copy}, ${extraction}, ${entry.study.url}, ${"d".repeat(64)},
        ${sha}, ${Math.max(...text.map(({ page }) => page))}, '[]', ${key})`

    yield* Effect.forEach(
      text,
      ({ page, part, text: words }) =>
        sql`INSERT INTO passage (version, page, part, text)
          VALUES (${version}, ${page}, ${part}, ${words})`,
      { discard: true },
    )

    if (object !== null)
      yield* Effect.promise(() => bucket.put(objectsOf(version).text, object ?? json))

    yield* sql`UPDATE paper SET active = ${version} WHERE id = ${entry.id}`

    return { paper: entry.id, version, copy }
  })

// A paper the gather kept only the metadata of.
export const list = ({
  paper: entry = bibliography(),
  reason = "no-licensed-pdf",
}: { readonly paper?: Bibliography; readonly reason?: Reason } = {}) =>
  write(entry, reason).pipe(Effect.as(entry.id))

// A paper whose only copy was withdrawn: its version and text are gone.
export const withdraw = ({
  paper: entry = bibliography(),
  reason = "Rights",
}: { readonly paper?: Bibliography; readonly reason?: Withdrawal } = {}) =>
  write(entry, null).pipe(Effect.andThen(copyOf(entry, "Withdrawn", reason)), Effect.as(entry.id))
