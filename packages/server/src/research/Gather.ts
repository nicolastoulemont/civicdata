// The paper gather: finds works on OpenAlex for each reviewed topic, checks
// each work's copies and licences, extracts admitted text, and writes the
// work into the paper store as `publication.ts` writes a corpus record. It
// runs the same in a Workflow and in a local runner, with no filesystem and
// no model call: the caller supplies the `Step` runner, the store's SQL
// client and bucket, and an HTTP client (docs/papers.md#gather).
import { Clock, Duration, Effect, Layer, Result, Schema, Struct } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { SqlClient } from "effect/sql"

import { Step, type StepFailed } from "../CatalogBuild.ts"
import { fingerprint } from "../fingerprint.ts"
import { Attempt, Content, Digest, Paper, PaperUnavailable, Seed, Work } from "./archive.ts"
import type { Bucket } from "./Bucket.ts"
import { admit } from "./copies.ts"
import { Licences } from "./Licences.ts"
import { metadataUrl, OpenAlex } from "./OpenAlex.ts"
import { extraction } from "./pdf.ts"
import { Record, write } from "./publication.ts"
import { Reason, tables } from "./store.ts"
import file from "./topics.json" with { type: "json" }

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

const Topics = Schema.Struct({ format: Schema.Literal(1), topics: Schema.NonEmptyArray(Topic) })

// How much one run asks for. A page and a batch hold at most 100 works:
// D1 binds at most 100 parameters, and OpenAlex filters at most 100 ids.
export interface Limits {
  // Pages of search results per topic.
  readonly pages: number
  // Works per page.
  readonly size: number
  // Works per gather step.
  readonly batch: number
  // Works gathered at once within a step.
  readonly concurrency: number
  // Failed attempts on one record before the work waits for its record to
  // change.
  readonly attempts: number
}

const defaults: Limits = { pages: 2, size: 50, batch: 10, concurrency: 2, attempts: 3 }

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
  // A copy's host, its PDF or the store failed. The next run tries again,
  // up to `attempts` times on one record.
  Failed: { operation: Schema.String, problem: Schema.String },
})

export type Outcome = typeof Outcome.Type

const Gathered = Schema.Struct({ work: Work.fields.id, title: Schema.String, outcome: Outcome })

const GatheredJson = Schema.fromJsonString(Schema.Array(Gathered))

const Found = Schema.Struct({
  next: Schema.NullOr(Schema.String),
  found: Schema.Int,
  skipped: Schema.Int,
  wanted: Schema.Array(Work.fields.id),
})

const FoundJson = Schema.fromJsonString(Found)

// What a run did: per topic, the works its pages listed, the records that
// did not decode, the works it asked for and why it stopped early; and per
// work it asked for, the outcome. A failure names the work and the problem,
// never the paper's text.
export interface Report {
  readonly topics: ReadonlyArray<{
    readonly query: string
    readonly found: number
    readonly skipped: number
    readonly wanted: number
    readonly problem: string | null
  }>
  readonly works: ReadonlyArray<typeof Gathered.Type>
}

// The ledger: one row per OpenAlex work the gather asked for. `hash` is the
// SHA-256 of the record's fields the gather reads, without `updated_date`,
// which OpenAlex moves whenever anything changes, citation counts included.
// Only the gather writes it and nothing reads it but the gather.
const ledger = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE IF NOT EXISTS work_gathered (
    work TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    updated TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (json_valid(outcome)),
    attempts INTEGER NOT NULL,
    at TEXT NOT NULL
  )`
})

const Row = Schema.Struct({
  work: Schema.String,
  hash: Schema.String,
  outcome: Schema.fromJsonString(Outcome),
  attempts: Schema.Int,
})

const hashOf = (work: Work) => fingerprint(JSON.stringify(Struct.omit(work, ["updated_date"])))

// The works of a page the run should ask for: new ones, ones whose record
// changed, and ones whose last attempt on this record failed under the limit.
const wantedOf = Effect.fnUntraced(function* (
  works: ReadonlyArray<Work>,
  { attempts }: { readonly attempts: number },
) {
  const sql = yield* SqlClient.SqlClient

  const rows = yield* sql`SELECT work, hash, outcome, attempts FROM work_gathered WHERE ${sql.in(
    "work",
    works.map((work) => work.id),
  )}`.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))))

  const held = new Map(rows.map((row) => [row.work, row]))

  return yield* Effect.filter(works, (work) =>
    Effect.map(hashOf(work), (hash) => {
      const row = held.get(work.id)

      return (
        row === undefined ||
        row.hash !== hash ||
        (Outcome.guards.Failed(row.outcome) && row.attempts < attempts)
      )
    }),
  )
})

// Records what the gather did with a work. A failure on the same record
// counts one more attempt; any other outcome, or a new record, starts over.
const record = Effect.fnUntraced(function* (work: Work, outcome: Outcome) {
  const sql = yield* SqlClient.SqlClient
  const failed = Outcome.guards.Failed(outcome) ? 1 : 0

  yield* sql`INSERT INTO work_gathered (work, hash, updated, outcome, attempts, at)
    VALUES (${work.id}, ${yield* hashOf(work)}, ${work.updated_date},
      ${yield* Schema.encodeEffect(Schema.fromJsonString(Outcome))(outcome)}, ${failed},
      ${new Date(yield* Clock.currentTimeMillis).toISOString()})
    ON CONFLICT (work) DO UPDATE SET
      attempts = CASE
        WHEN ${failed} = 0 THEN 0
        WHEN work_gathered.hash = excluded.hash
          AND json_extract(work_gathered.outcome, '$._tag') = 'Failed'
          THEN work_gathered.attempts + 1
        ELSE 1 END,
      hash = excluded.hash, updated = excluded.updated, outcome = excluded.outcome,
      at = excluded.at`
})

// The seed a work's paper is published under, as discovery always made it:
// its id hashes the OpenAlex id, so a corpus record and the gather name the
// same paper.
const seedOf = Effect.fnUntraced(function* (work: Work) {
  return yield* Seed.makeEffect({
    id: yield* fingerprint(work.id),
    openalex: work.id,
    study: {
      title: work.title,
      year: work.publication_year,
      doi: work.doi?.replace(/^https:\/\/doi.org\//i, "") ?? null,
      authors: work.authorships.flatMap(({ author }) =>
        author.display_name === null ? [] : [author.display_name],
      ),
      publisher:
        work.locations.find((location) => location.raw_source_name)?.raw_source_name ?? null,
      url: work.id,
    },
  }).pipe(Effect.mapError((cause) => new PaperUnavailable({ operation: "metadata", cause })))
})

// The paper the store holds for this work under another id, if any: a copy
// `papers:intake` audited by hand, whose id hashes its DOI and URL.
const coverOf = Effect.fnUntraced(function* (work: Work, { paper }: { readonly paper: string }) {
  const sql = yield* SqlClient.SqlClient

  const [held] = yield* sql`SELECT id FROM paper
    WHERE openalex = ${work.id} AND id <> ${paper} ORDER BY id LIMIT 1`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: Digest })))),
  )

  return held?.id ?? null
})

// What the store holds for a work once its paper is published: its text,
// or its metadata with why. A copy whose host or PDF failed makes the work
// fail, so the next run tries it again.
const outcomeOf = Effect.fnUntraced(function* (
  gathered: Effect.Success<ReturnType<typeof admit>>,
  { paper }: { readonly paper: Seed["id"] },
) {
  const { content } = gathered

  if (Content.guards.Text(content))
    return Outcome.cases.Text.make({
      paper,
      version: yield* fingerprint(`${content.id}|${extraction}`),
    })

  const failed = gathered.attempts.flatMap(({ result }) =>
    Attempt.fields.result.guards.Failed(result) ? [result] : [],
  )[0]

  return failed === undefined
    ? Outcome.cases.Metadata.make({ paper, reason: content.reason })
    : Outcome.cases.Failed.make({ operation: failed.operation, problem: failed.problem })
})

// The store failed under a write; the next run tries again.
const unstored = (problem: string) =>
  Effect.succeed(Outcome.cases.Failed.make({ operation: "store", problem }))

// Writes a work's paper, as a corpus record of it would be published.
const store = Effect.fnUntraced(function* (work: Work, seed: Seed) {
  const gathered = work.is_retracted
    ? {
        content: Content.cases.Metadata.make({ reason: "retracted" }),
        attempts: [],
        pdf: null,
      }
    : yield* admit(work)

  const paper = Paper.make({
    format: 3,
    seed,
    metadataUrl: metadataUrl(work.id),
    retrievedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    work,
    attempts: gathered.attempts,
    content: gathered.content,
  })

  const { content, pdf } = gathered

  const published =
    Content.guards.Text(content) && pdf !== null
      ? write(Record.Text({ paper: { ...paper, content }, pdf, annotation: null }))
      : write(Record.Metadata({ paper }))

  return yield* published.pipe(
    Effect.flatMap(() => outcomeOf(gathered, { paper: seed.id })),
    Effect.catchTags({
      Refused: ({ problem }) =>
        Effect.succeed(Outcome.cases.Refused.make({ paper: seed.id, problem })),
      ObjectMismatch: ({ key }) => unstored(`R2 holds other bytes at ${key}`),
      BucketUnavailable: ({ operation, key, problem }) =>
        unstored(`R2 ${operation} ${key}: ${problem}`),
    }),
  )
})

// Gathers one work and records the outcome. One work's failure never
// fails another's.
const gatherOne = Effect.fnUntraced(function* (work: Work) {
  const outcome = yield* Effect.gen(function* () {
    const seed = yield* seedOf(work)
    const cover = yield* coverOf(work, { paper: seed.id })

    if (cover !== null) return Outcome.cases.Covered.make({ paper: cover })

    return yield* store(work, seed)
  }).pipe(
    Effect.catchTags({
      PaperUnavailable: ({ operation, cause }) =>
        Effect.succeed(Outcome.cases.Failed.make({ operation, problem: String(cause) })),
      SqlError: ({ message }) =>
        Effect.succeed(Outcome.cases.Failed.make({ operation: "store", problem: message })),
      SchemaError: ({ message }) =>
        Effect.succeed(Outcome.cases.Failed.make({ operation: "store", problem: message })),
    }),
  )

  yield* record(work, outcome)

  return Gathered.make({ work: work.id, title: work.title, outcome })
})

// One page of a topic's search, and which of its works the run wants.
const discover = Effect.fnUntraced(function* (
  topic: Topic,
  { cursor, limits }: { readonly cursor: string; readonly limits: Limits },
) {
  const openalex = yield* OpenAlex
  const page = yield* openalex.page(topic, { cursor, size: limits.size })
  const wanted = yield* wantedOf(page.works, limits)

  return Found.make({
    next: page.next,
    found: page.works.length,
    skipped: page.skipped,
    wanted: wanted.map((work) => work.id),
  })
})

// Gathers a batch of works the run wants, from their current records. A
// work OpenAlex no longer lists records nothing: the next run asks again.
const batch = Effect.fnUntraced(function* (
  ids: ReadonlyArray<Work["id"]>,
  { limits }: { readonly limits: Limits },
) {
  const openalex = yield* OpenAlex
  const records = yield* openalex.works(ids)

  return yield* Effect.forEach(
    ids,
    (id) => {
      const work = records.get(id)

      return work === undefined
        ? Effect.succeed(
            Gathered.make({
              work: id,
              title: "",
              outcome: Outcome.cases.Failed.make({
                operation: "metadata",
                problem: "OpenAlex no longer lists the work",
              }),
            }),
          )
        : gatherOne(work)
    },
    { concurrency: limits.concurrency },
  )
})

const chunks = <A>(items: ReadonlyArray<A>, size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  )

const messageOf = (cause: unknown) =>
  Schema.is(PaperUnavailable)(cause) ? `${cause.operation}: ${String(cause.cause)}` : String(cause)

// What a step's work needs: the store and the sources.
type Services = OpenAlex | Licences | SqlClient.SqlClient | Bucket

// One topic, page by page. A page that fails ends the topic; a batch that
// fails leaves its works unrecorded, so the next run asks for them again,
// and the topic goes on. `seen` holds the works this run already asked for
// under an earlier topic or page.
const gatherTopic = Effect.fnUntraced(function* (
  topic: Topic,
  {
    index,
    limits,
    seen,
  }: { readonly index: number; readonly limits: Limits; readonly seen: Set<string> },
) {
  const step = yield* Step
  // A step's body runs on its own, so it carries the run's services.
  const context = yield* Effect.context<Services>()
  const works: Array<typeof Gathered.Type> = []
  const problems: Array<string> = []
  const totals = { found: 0, skipped: 0, wanted: 0 }
  let cursor: string | null = "*"

  for (let page = 1; page <= limits.pages && cursor !== null; page += 1) {
    const saved: Result.Result<string, StepFailed> = yield* Effect.result(
      step.run(
        `discover ${index} ${page}`,
        discover(topic, { cursor, limits }).pipe(
          Effect.flatMap(Schema.encodeEffect(FoundJson)),
          Effect.provideContext(context),
        ),
      ),
    )

    if (Result.isFailure(saved)) {
      problems.push(`page ${page}: ${messageOf(saved.failure.cause)}`)
      break
    }

    const found: typeof Found.Type = yield* Schema.decodeEffect(FoundJson)(saved.success).pipe(
      Effect.orDie,
    )

    const wanted = found.wanted.filter((id) => !seen.has(id))
    totals.found += found.found
    totals.skipped += found.skipped
    totals.wanted += wanted.length
    cursor = found.next

    for (const [part, ids] of chunks(wanted, limits.batch).entries()) {
      for (const id of ids) seen.add(id)

      const done = yield* Effect.result(
        step.run(
          `gather ${index} ${page} ${part}`,
          batch(ids, { limits }).pipe(
            Effect.flatMap(Schema.encodeEffect(GatheredJson)),
            Effect.provideContext(context),
          ),
        ),
      )

      if (Result.isFailure(done))
        problems.push(`page ${page} batch ${part}: ${messageOf(done.failure.cause)}`)
      else
        works.push(...(yield* Schema.decodeEffect(GatheredJson)(done.success).pipe(Effect.orDie)))
    }
  }

  return {
    topic: {
      query: topic.query,
      ...totals,
      problem: problems.length === 0 ? null : problems.join("; "),
    },
    works,
  }
})

// Gathers every topic of the reviewed topic file, or the topics given. A
// run asks only for works the ledger says changed or failed under the
// attempt limit, so a run after an unchanged one fetches no copy.
export const run = Effect.fn("Papers.gather")(function* (
  options: { readonly topics?: ReadonlyArray<Topic>; readonly limits?: Partial<Limits> } = {},
) {
  const step = yield* Step
  const settings = { ...defaults, ...options.limits }
  const topics = options.topics ?? (yield* Schema.decodeUnknownEffect(Topics)(file)).topics

  const context = yield* Effect.context<SqlClient.SqlClient>()
  yield* step.run("tables", Effect.andThen(tables, ledger).pipe(Effect.provideContext(context)))

  const seen = new Set<string>()
  const results: Array<Report["topics"][number]> = []
  const works: Array<typeof Gathered.Type> = []

  for (const [index, topic] of topics.entries()) {
    const done = yield* gatherTopic(topic, { index, limits: settings, seen })
    results.push(done.topic)
    works.push(...done.works)
  }

  return { topics: results, works } satisfies Report
})

// Waits between requests to one host, so no publisher sees more than one
// request per `gap` from us, and names the client generically. Other hosts
// go on meanwhile.
export interface Pacing {
  readonly gap: Duration.Duration
  readonly hosts: Readonly<globalThis.Record<string, Duration.Duration>>
}

export const pacing: Pacing = {
  gap: Duration.seconds(2),
  hosts: { "api.openalex.org": Duration.seconds(1) },
}

// A generic client name, without a contact address or API key.
const agent = "papers-gather/1.0"

export const paced = (options: Pacing = pacing) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const next = new Map<string, number>()

      const slot = (host: string) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const gap = Duration.toMillis(options.hosts[host] ?? options.gap)
          const at = Math.max(now, next.get(host) ?? 0)
          next.set(host, at + gap)

          if (at > now) yield* Effect.sleep(at - now)
        })

      return http.pipe(
        HttpClient.mapRequest(HttpClientRequest.setHeader("user-agent", agent)),
        HttpClient.mapRequestEffect((request) =>
          slot(new URL(request.url).host).pipe(Effect.as(request)),
        ),
      )
    }),
  )

// OpenAlex and the licence pages over the caller's HTTP client.
export const sources = Layer.mergeAll(OpenAlex.layer, Licences.layer)
