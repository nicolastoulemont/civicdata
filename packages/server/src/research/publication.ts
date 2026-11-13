// Publication: writes one gathered paper into a stage's paper store, and
// withdraws a copy's text (docs/papers.md). The publication command and the
// gather share it, so both write the same rows in the same order. It asks no
// model: an annotation comes with the record or not at all.
import { Array as Arr, Data, Effect, Option, Schema } from "effect"
import { SqlClient, type SqlError } from "effect/sql"

import { fingerprint } from "../fingerprint.ts"
import type { Annotation } from "./annotation.ts"
import { Attempt, Content, Copy, Evidence, type Paper, Seed, Work } from "./archive.ts"
import { Bucket, type BucketUnavailable } from "./Bucket.ts"
import type { Document } from "./entry.ts"
import { extraction } from "./pdf.ts"
import { annotationKey, Body, objectsOf, tables, Text, Withdrawal } from "./store.ts"

// The store refuses what a record asks: text for a paper the record lists
// as metadata-only while the store still serves its text (withdraw it
// first), a copy the store holds for another paper, or other text under an
// extraction the store already holds.
export class Refused extends Schema.TaggedError<Refused, { readonly brand: unique symbol }>()(
  "Refused",
  { problem: Schema.String },
) {}

// An object R2 holds after an upload differs from the bytes sent.
export class ObjectMismatch extends Schema.TaggedError<
  ObjectMismatch,
  { readonly brand: unique symbol }
>()("ObjectMismatch", { key: Schema.String }) {}

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

// The columns publication writes, exactly as it writes them, so a run
// compares them with what the store holds and skips a paper whose rows match.
const PaperRow = Schema.Struct({
  id: Schema.String,
  openalex: Schema.NullOr(Schema.String),
  study: Schema.String,
  work: Schema.NullOr(Schema.String),
  metadata_url: Schema.NullOr(Schema.String),
  retrieved_at: Schema.String,
  reason: Schema.NullOr(Schema.String),
})

type PaperRow = typeof PaperRow.Type

const CopyRow = Schema.Struct({
  id: Schema.String,
  paper: Schema.String,
  location: Schema.String,
  evidence: Schema.String,
  admission: Schema.Literals(["Admitted", "Restricted", "Retracted", "Unidentified", "Withdrawn"]),
})

type CopyRow = typeof CopyRow.Type

const VersionRow = Schema.Struct({
  id: Schema.String,
  paper: Schema.String,
  copy: Schema.String,
  extraction: Schema.String,
  url: Schema.String,
  pdf: Schema.String,
  text: Schema.String,
  pages: Schema.Finite,
  empty_pages: Schema.String,
})

type VersionRow = typeof VersionRow.Type

const AnnotationRow = Schema.Struct({
  key: Schema.String,
  text: Schema.String,
  extraction: Schema.String,
  model: Schema.String,
  rubric: Schema.String,
  body: Schema.String,
  created_at: Schema.String,
})

type AnnotationRow = typeof AnnotationRow.Type

// What the store holds for one paper.
const Stored = {
  paper: PaperRow.mapFields((fields) => ({ ...fields, active: Schema.NullOr(Schema.String) })),
  copy: CopyRow.mapFields((fields) => ({ ...fields, withdrawal: Schema.NullOr(Withdrawal) })),
  version: VersionRow.mapFields((fields) => ({
    ...fields,
    annotation: Schema.NullOr(Schema.String),
    body: Schema.NullOr(Schema.String),
  })),
}

type Stored = { readonly [K in keyof typeof Stored]: (typeof Stored)[K]["Type"] }

interface Store {
  readonly paper: Stored["paper"] | undefined
  readonly copies: ReadonlyMap<string, Stored["copy"]>
  readonly version: Stored["version"] | undefined
}

// What the store should hold for one paper.
interface Plan {
  readonly paper: PaperRow
  readonly copies: ReadonlyArray<CopyRow>
  readonly text: {
    readonly version: VersionRow
    readonly passages: Arr.NonEmptyReadonlyArray<(typeof Text.Type)[number]>
    readonly pdf: Uint8Array
    readonly object: string
    readonly annotation: AnnotationRow | null
  } | null
}

const json = <S extends Schema.Top>(schema: S) =>
  Schema.encodeEffect(Schema.fromJsonString(Schema.toCodecJson(schema)))

type Columns = Readonly<globalThis.Record<string, string | number | null>>

// Whether the store holds every column a row would write, as it would.
const same = (want: Columns, have: Columns | undefined) => {
  if (have === undefined) return false
  const held = new Map(Object.entries(have))

  return Object.entries(want).every(([key, value]) => held.get(key) === value)
}

// Copies the gather tried and excluded, never fetched: each id hashes the
// paper, the location and the source version, since two records of one work
// list the same locations. A failed attempt decides nothing and stays out;
// the next gather retries it.
const restricted = (record: Record) =>
  Effect.forEach(
    record.paper.attempts.filter(({ result }) => Attempt.fields.result.guards.Excluded(result)),
    ({ copy }) =>
      Effect.gen(function* () {
        return CopyRow.make({
          id: yield* fingerprint(`${record.paper.seed.id}|${copy.id}|${copy.version}`),
          paper: record.paper.seed.id,
          location: yield* json(Copy)(copy),
          evidence: "[]",
          admission: "Restricted",
        })
      }),
  )

const annotationOf = (
  annotation: typeof Annotation.Type | null,
  { text }: { readonly text: string },
) =>
  Effect.gen(function* () {
    if (annotation === null) return null
    const { stamp, ...body } = annotation
    const { model, rubric, createdAt } = stamp

    return AnnotationRow.make({
      key: yield* annotationKey({ text, extraction, model, rubric }),
      text,
      extraction,
      model,
      rubric,
      body: yield* json(Body)(body),
      created_at: createdAt,
    })
  })

const textOf = (record: Data.TaggedEnum.Value<Record, "Text">) =>
  Effect.gen(function* () {
    const { content, seed } = record.paper
    const object = yield* Schema.encodeEffect(Text)(content.passages)
    const text = yield* fingerprint(object)

    const version = VersionRow.make({
      id: yield* fingerprint(`${content.id}|${extraction}`),
      paper: seed.id,
      copy: content.id,
      extraction,
      url: content.url,
      pdf: content.sha256,
      text,
      pages: content.pages,
      empty_pages: JSON.stringify(content.emptyPages),
    })

    const copy = CopyRow.make({
      id: content.id,
      paper: seed.id,
      location: yield* json(Copy)(content.copy),
      evidence: yield* json(Schema.Array(Evidence))(content.evidence),
      admission: "Admitted",
    })

    return {
      copy,
      text: {
        version,
        passages: content.passages,
        pdf: record.pdf,
        object,
        annotation: yield* annotationOf(record.annotation, { text }),
      },
    }
  })

const planOf = (record: Record) =>
  Effect.gen(function* () {
    const { seed, work, metadataUrl, retrievedAt, content } = record.paper
    const held = Record.$is("Text")(record) ? yield* textOf(record) : null

    return {
      paper: PaperRow.make({
        id: seed.id,
        openalex: seed.openalex,
        study: yield* json(Seed.fields.study)(seed.study),
        work: work === null ? null : yield* json(Work)(work),
        metadata_url: metadataUrl,
        retrieved_at: retrievedAt,
        reason: Content.guards.Metadata(content) ? content.reason : null,
      }),
      copies: [...(held === null ? [] : [held.copy]), ...(yield* restricted(record))],
      text: held?.text ?? null,
    } satisfies Plan
  })

const rows = <S extends Schema.Top>(schema: S) => Schema.decodeUnknownEffect(Schema.Array(schema))

// The rows the store holds for a plan's paper: the paper, every copy of it
// or under one of the plan's copy ids, and the plan's version.
const storeOf = Effect.fnUntraced(function* (plan: Plan) {
  const sql = yield* SqlClient.SqlClient
  const { id } = plan.paper

  const [paper] = yield* sql`SELECT id, openalex, study, work, metadata_url, retrieved_at, reason,
    active FROM paper WHERE id = ${id}`.pipe(Effect.flatMap(rows(Stored.paper)))

  const copies = yield* sql`SELECT id, paper, location, evidence, admission, withdrawal
    FROM copy WHERE paper = ${id} OR ${sql.in(
      "id",
      plan.copies.map((copy) => copy.id),
    )}`.pipe(Effect.flatMap(rows(Stored.copy)))

  const [version] =
    plan.text === null
      ? []
      : yield* sql`SELECT version.id, version.paper, version.copy, version.extraction,
          version.url, version.pdf, version.text, version.pages, version.empty_pages,
          version.annotation, annotation.body
        FROM version LEFT JOIN annotation ON annotation.key = version.annotation
        WHERE version.id = ${plan.text.version.id}`.pipe(Effect.flatMap(rows(Stored.version)))

  return {
    paper,
    copies: new Map(copies.map((row) => [row.id, row])),
    version,
  } satisfies Store
})

// Why the store refuses a paper's rows, if it does: a copy it holds for
// another paper, or a metadata reason while it serves the paper's text.
const refusalOf = (plan: Plan, store: Store) => {
  const taken = plan.copies.find((copy) => {
    const owner = store.copies.get(copy.id)?.paper

    return owner !== undefined && owner !== copy.paper
  })

  if (taken !== undefined) return `Copy ${taken.id} belongs to another paper`

  if (plan.paper.reason !== null && (store.paper?.active ?? null) !== null)
    return "The record lists the paper as metadata-only; withdraw its copy first"

  return null
}

// What a version needs written. Its text never changes under one id.
const versionSteps = (
  text: NonNullable<Plan["text"]>,
  { active, store }: { readonly active: string | null; readonly store: Store },
) =>
  Effect.gen(function* () {
    const have = store.version

    if (have !== undefined && (have.text !== text.version.text || have.pdf !== text.version.pdf))
      return yield* new Refused({
        problem: `Version ${have.id} holds other text; give the extraction a new version`,
      })

    const annotation =
      text.annotation !== null &&
      (have?.annotation !== text.annotation.key || have.body !== text.annotation.body)
        ? text.annotation
        : null

    const activate = active !== text.version.id

    return { annotation, version: activate || !same(text.version, have), activate }
  })

// What a paper needs written, in the order a writer must follow. A
// withdrawn copy stays withdrawn: publication never admits its text again.
const stepsOf = (plan: Plan, store: Store) =>
  Effect.gen(function* () {
    const refusal = refusalOf(plan, store)

    if (refusal !== null) return yield* new Refused({ problem: refusal })
    const withdrawn = (copy: string) => store.copies.get(copy)?.admission === "Withdrawn"

    const changed = {
      paper: !same(plan.paper, store.paper),
      copies: plan.copies.filter(
        (copy) => !withdrawn(copy.id) && !same(copy, store.copies.get(copy.id)),
      ),
    }

    if (plan.text === null || withdrawn(plan.text.version.copy))
      return { ...changed, annotation: null, version: false, activate: false }

    return {
      ...changed,
      ...(yield* versionSteps(plan.text, { active: store.paper?.active ?? null, store })),
    }
  })

type Steps = Effect.Success<ReturnType<typeof stepsOf>>

const unchanged = (steps: Steps) =>
  !steps.paper &&
  steps.copies.length === 0 &&
  steps.annotation === null &&
  !steps.version &&
  !steps.activate

// Uploads an object and reads it back: a version becomes active only when
// R2 holds exactly its bytes.
const upload = Effect.fnUntraced(function* (key: string, body: Uint8Array) {
  const bucket = yield* Bucket
  const sent = yield* fingerprint(body)
  yield* bucket.put(key, body)
  const held = yield* bucket.get(key)

  if (Option.isNone(held) || (yield* fingerprint(held.value)) !== sent)
    return yield* new ObjectMismatch({ key })

  return undefined
})

// The version's passages, its objects, then the paper's active pointer,
// last: until then readers keep the previous active version.
const activate = Effect.fnUntraced(function* (
  text: NonNullable<Plan["text"]>,
  { paper }: { readonly paper: string },
) {
  const sql = yield* SqlClient.SqlClient
  const { id } = text.version

  // D1 binds at most 100 parameters per statement: four per passage. Never
  // INSERT OR REPLACE: SQLite runs no delete trigger for a replaced row, so
  // search would keep the old passage.
  for (const chunk of Arr.chunksOf(text.passages, 20))
    yield* sql`INSERT INTO passage ${sql.insert(
      Arr.map(chunk, ({ page, part, text: words }) => ({ version: id, page, part, text: words })),
    )} ON CONFLICT DO NOTHING`

  yield* upload(objectsOf(id).pdf, text.pdf)
  yield* upload(objectsOf(id).text, new TextEncoder().encode(text.object))
  yield* sql`UPDATE paper SET active = ${id} WHERE id = ${paper}`
})

const apply = Effect.fnUntraced(function* (plan: Plan, steps: Steps) {
  const sql = yield* SqlClient.SqlClient

  if (steps.paper)
    yield* sql`INSERT INTO paper ${sql.insert(plan.paper)} ON CONFLICT (id) DO UPDATE SET
      openalex = excluded.openalex, study = excluded.study, work = excluded.work,
      metadata_url = excluded.metadata_url, retrieved_at = excluded.retrieved_at,
      reason = excluded.reason`

  for (const copy of steps.copies)
    yield* sql`INSERT INTO copy ${sql.insert(copy)} ON CONFLICT (id) DO UPDATE SET
      location = excluded.location, evidence = excluded.evidence, admission = excluded.admission`

  const text = plan.text

  if (text === null) return

  if (steps.version)
    yield* sql`INSERT INTO version ${sql.insert(text.version)}
      ON CONFLICT (id) DO UPDATE SET url = excluded.url`

  // An annotation the Workflow wrote stays when the record has none.
  if (steps.annotation !== null) {
    yield* sql`INSERT INTO annotation ${sql.insert(steps.annotation)} ON CONFLICT (key) DO UPDATE SET
      body = excluded.body, created_at = excluded.created_at`
    yield* sql`UPDATE version SET annotation = ${steps.annotation.key} WHERE id = ${text.version.id}`
  }

  if (steps.activate) yield* activate(text, { paper: plan.paper.id })
})

// Writes one paper. It reads the paper's rows first and writes nothing
// when they already match. The caller runs `tables` once before.
export const write = Effect.fn("Papers.write")(function* (record: Record) {
  const plan = yield* planOf(record)
  const steps = yield* stepsOf(plan, yield* storeOf(plan))

  if (unchanged(steps)) return Published.Unchanged()
  yield* apply(plan, steps)
  const text = plan.text !== null && steps.activate ? plan.text : null

  return Published.Written({
    version: text?.version.id ?? null,
    annotation: text?.annotation?.key ?? null,
  })
})

// Removes a copy's text from the store, in the order docs/papers.md gives:
// the paper's active pointer, the objects, the versions with their passages
// and annotation pointers, then the copy's admission and reason. An
// annotation stays, since another copy with the same text may point to it.
export const withdraw = Effect.fn("Papers.withdraw")(function* (
  copy: string,
  { reason }: { readonly reason: Withdrawal },
) {
  const sql = yield* SqlClient.SqlClient
  const bucket = yield* Bucket
  yield* tables

  const [found] = yield* sql`SELECT id, paper, location, evidence, admission, withdrawal
    FROM copy WHERE id = ${copy}`.pipe(Effect.flatMap(rows(Stored.copy)))

  if (found === undefined) return yield* new Refused({ problem: `No copy ${copy}` })

  if (found.admission === "Withdrawn" && found.withdrawal === reason)
    return { paper: found.paper, versions: 0 }

  if (found.admission !== "Admitted" && found.admission !== "Withdrawn")
    return yield* new Refused({ problem: `Copy ${copy} is ${found.admission} and has no text` })

  const versions = yield* sql`SELECT id FROM version WHERE copy = ${copy}`.pipe(
    Effect.flatMap(rows(Schema.Struct({ id: Schema.String }))),
  )

  yield* sql`UPDATE paper SET active = NULL
    WHERE id = ${found.paper} AND active IN (SELECT id FROM version WHERE copy = ${copy})`

  for (const { id } of versions) {
    yield* bucket.remove(objectsOf(id).pdf)
    yield* bucket.remove(objectsOf(id).text)
  }

  yield* sql`DELETE FROM version WHERE copy = ${copy}`
  yield* sql`UPDATE copy SET admission = 'Withdrawn', withdrawal = ${reason} WHERE id = ${copy}`

  return { paper: found.paper, versions: versions.length }
})
