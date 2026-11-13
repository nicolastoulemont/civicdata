// The PaperGather Workflow's work (docs/papers.md#weekly-gather): each run
// searches every topic from the day of the last run that searched it in
// full, gathers within its caps through the shared core (`Gather.ts`), and
// records what it did. Only this Workflow writes the run records.

// The ambient declaration must reach every program that compiles this file,
// including apps/web; a .d.ts cannot be imported.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="../cloudflare.d.ts" />

import { D1Client } from "@effect/sql-d1"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { SqlClient } from "effect/sql"

import { Step } from "../CatalogBuild.ts"
import { Pace } from "../Pace.ts"
import { Bucket } from "./Bucket.ts"
import {
  anonymous,
  type Cap,
  type Fetched,
  Outcome,
  type Report,
  run,
  type Searched,
  sources,
  type Topic,
} from "./Gather.ts"

const megabyte = 1024 * 1024

// The most one run may fetch. 61 topics of two pages each take 122 search
// requests, which leaves 128 batches of records. Extracting text is the
// costly part of a step: 100 PDFs of 200 MB in all stay within the Worker's
// five minutes of CPU even if every step of a run counted against one
// invocation. Work past a cap waits for the next run.
export const Caps = Context.Reference<Fetched>("@repo/server/research/Caps", {
  defaultValue: () => ({ requests: 250, works: 300, pdfs: 100, bytes: 200 * megabyte }),
})

// What a run did with one topic, as `gather_topic` holds it. A topic is
// complete when its search ran to its last page with no failed page,
// batch or work, no work held by another run and no cap reached: the next
// run asks only for works updated from the day this run started.
const Topical = Schema.Struct({
  topic: Schema.String,
  query: Schema.String,
  since: Schema.NullOr(Schema.String),
  seen: Schema.Int,
  skipped: Schema.Int,
  unchanged: Schema.Int,
  wanted: Schema.Int,
  held: Schema.Int,
  waiting: Schema.Int,
  failed: Schema.Int,
  complete: Schema.Boolean,
  problem: Schema.NullOr(Schema.String),
})

// Why works ended as they did: metadata-only works by reason, and each work
// that failed or that the store refused, with the problem.
const Reasons = Schema.Struct({
  metadata: Schema.Record(Schema.String, Schema.Int),
  failed: Schema.Array(
    Schema.Struct({
      work: Schema.String,
      title: Schema.String,
      operation: Schema.String,
      problem: Schema.String,
    }),
  ),
  refused: Schema.Array(
    Schema.Struct({ work: Schema.String, title: Schema.String, problem: Schema.String }),
  ),
})

// One run's record, the Workflow's output: the works its searches listed
// (`seen`), those it admitted text for, kept as metadata only, found
// unchanged in the ledger, left to a hand-audited copy, saw refused, saw
// fail, found held by another run or left waiting past a cap; what it
// fetched; the cap that stopped it; the reasons; and each topic.
interface Record {
  readonly run: string
  readonly started: string
  readonly ended: string
  readonly seen: number
  readonly admitted: number
  readonly metadata: number
  readonly unchanged: number
  readonly covered: number
  readonly refused: number
  readonly failed: number
  readonly held: number
  readonly waiting: number
  readonly requests: number
  readonly pdfs: number
  readonly bytes: number
  readonly stopped: Cap | null
  readonly reasons: typeof Reasons.Type
  readonly topics: ReadonlyArray<typeof Topical.Type>
}

// The run records, beside the ledger. `gather_run` holds one row per run,
// `gather_topic` one per run and topic. Only this Workflow writes them.
const tables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE IF NOT EXISTS gather_run (
    run TEXT PRIMARY KEY,
    started TEXT NOT NULL,
    ended TEXT NOT NULL,
    seen INTEGER NOT NULL,
    admitted INTEGER NOT NULL,
    metadata INTEGER NOT NULL,
    unchanged INTEGER NOT NULL,
    covered INTEGER NOT NULL,
    refused INTEGER NOT NULL,
    failed INTEGER NOT NULL,
    held INTEGER NOT NULL,
    waiting INTEGER NOT NULL,
    requests INTEGER NOT NULL,
    pdfs INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    stopped TEXT CHECK (stopped IN ('requests', 'works', 'pdfs', 'bytes')),
    reasons TEXT NOT NULL CHECK (json_valid(reasons))
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS gather_topic (
    run TEXT NOT NULL REFERENCES gather_run (run),
    topic TEXT NOT NULL,
    query TEXT NOT NULL,
    since TEXT,
    seen INTEGER NOT NULL,
    skipped INTEGER NOT NULL,
    unchanged INTEGER NOT NULL,
    wanted INTEGER NOT NULL,
    held INTEGER NOT NULL,
    waiting INTEGER NOT NULL,
    failed INTEGER NOT NULL,
    complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
    problem TEXT,
    PRIMARY KEY (run, topic)
  )`
})

const Since = Schema.Array(Schema.Struct({ topic: Schema.String, since: Schema.String }))

const SinceJson = Schema.fromJsonString(Since)

// How far before the last complete run a weekly search reaches back.
// OpenAlex often lists a work weeks after its publication date, so a search
// from the last run's own day would miss it. Works the store already holds
// cost a search page, never a PDF (the ledger's hash).
const lookback = "-90 days"

// Each topic's day: `lookback` before the start of the last run that
// completed it.
const sinceOf = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* tables

  return yield* sql`SELECT gather_topic.topic AS topic,
      date(max(gather_run.started), ${lookback}) AS since
    FROM gather_topic JOIN gather_run ON gather_run.run = gather_topic.run
    WHERE gather_topic.complete = 1
    GROUP BY gather_topic.topic`.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Since)))
})

const complete = (topic: Searched) =>
  topic.problem === null && !topic.capped && topic.held === 0 && topic.failed === 0

const sum = (topics: ReadonlyArray<Searched>, field: "found" | "unchanged" | "held" | "waiting") =>
  topics.reduce((total, topic) => total + topic[field], 0)

// The record of a run's report, but for when it ended.
const recordOf = (
  report: Report,
  { run: id, started }: { readonly run: string; readonly started: string },
): Omit<Record, "ended"> => {
  const { works, topics, fetched } = report

  const count = (is: (outcome: Outcome) => boolean) =>
    works.filter(({ outcome }) => is(outcome)).length

  const metadata: globalThis.Record<string, number> = {}

  for (const { outcome } of works)
    if (Outcome.guards.Metadata(outcome))
      metadata[outcome.reason] = (metadata[outcome.reason] ?? 0) + 1

  return {
    run: id,
    started,
    seen: sum(topics, "found"),
    admitted: count(Outcome.guards.Text),
    metadata: count(Outcome.guards.Metadata),
    unchanged: sum(topics, "unchanged"),
    covered: count(Outcome.guards.Covered),
    refused: count(Outcome.guards.Refused),
    failed: count(Outcome.guards.Failed),
    held: sum(topics, "held"),
    waiting: sum(topics, "waiting"),
    requests: fetched.requests,
    pdfs: fetched.pdfs,
    bytes: fetched.bytes,
    stopped: report.stopped,
    reasons: {
      metadata,
      failed: works.flatMap(({ work, title, outcome }) =>
        Outcome.guards.Failed(outcome)
          ? [{ work, title, operation: outcome.operation, problem: outcome.problem }]
          : [],
      ),
      refused: works.flatMap(({ work, title, outcome }) =>
        Outcome.guards.Refused(outcome) ? [{ work, title, problem: outcome.problem }] : [],
      ),
    },
    topics: topics.map((topic) => ({
      topic: topic.key,
      query: topic.query,
      since: topic.since,
      seen: topic.found,
      skipped: topic.skipped,
      unchanged: topic.unchanged,
      wanted: topic.wanted,
      held: topic.held,
      waiting: topic.waiting,
      failed: topic.failed,
      complete: complete(topic),
      problem: topic.problem,
    })),
  }
}

// Writes the record in one D1 batch, so a topic's day moves only with its
// run's row. A retried step writes the same rows again. Answers when the run
// ended.
const write = Effect.fnUntraced(function* (record: Omit<Record, "ended">) {
  const sql = yield* SqlClient.SqlClient
  const d1 = yield* D1Client.D1Client
  const ended = new Date(yield* Clock.currentTimeMillis).toISOString()
  const { topics, reasons, ...row } = record

  yield* d1.batch([
    sql`INSERT INTO gather_run (run, started, ended, seen, admitted, metadata, unchanged,
        covered, refused, failed, held, waiting, requests, pdfs, bytes, stopped, reasons)
      VALUES (${row.run}, ${row.started}, ${ended}, ${row.seen}, ${row.admitted},
        ${row.metadata}, ${row.unchanged}, ${row.covered}, ${row.refused}, ${row.failed},
        ${row.held}, ${row.waiting}, ${row.requests}, ${row.pdfs}, ${row.bytes},
        ${row.stopped}, ${yield* Schema.encodeEffect(Schema.fromJsonString(Reasons))(reasons)})
      ON CONFLICT (run) DO NOTHING`,
    sql`INSERT INTO gather_topic (run, topic, query, since, seen, skipped, unchanged, wanted,
        held, waiting, failed, complete, problem)
      SELECT ${row.run}, value ->> 'topic', value ->> 'query', value ->> 'since',
        value ->> 'seen', value ->> 'skipped', value ->> 'unchanged', value ->> 'wanted',
        value ->> 'held', value ->> 'waiting', value ->> 'failed', value ->> 'complete',
        value ->> 'problem'
      FROM json_each(${yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Topical)))(topics)})
      WHERE true
      ON CONFLICT (run, topic) DO NOTHING`,
  ])

  return ended
})

// What a run's steps need: the store and the sources.
type Services = SqlClient.SqlClient | D1Client.D1Client | Bucket | Layer.Success<typeof sources>

// Runs one instance: reads each topic's day, gathers, and records the run.
// `run` is the instance's id, which also claims the works; `started` its
// start time, from which the next run searches each topic it completes.
// `topics` replaces the reviewed topic file.
export const gather = Effect.fn("Papers.run")(function* (
  instance: { readonly run: string; readonly started: string },
  options: { readonly topics?: ReadonlyArray<Topic> } = {},
) {
  const step = yield* Step
  // A step's body runs on its own, so it carries the run's services.
  const context = yield* Effect.context<Services>()

  const planned = yield* step.run(
    "plan",
    sinceOf.pipe(Effect.flatMap(Schema.encodeEffect(SinceJson)), Effect.provideContext(context)),
  )

  const since = yield* Schema.decodeEffect(SinceJson)(planned).pipe(Effect.orDie)

  const report = yield* run({
    ...options,
    since: new Map(since.map(({ topic, since: day }) => [topic, day])),
    caps: yield* Caps,
    run: instance.run,
  })

  const record = recordOf(report, instance)
  const ended = yield* step.run("record", write(record).pipe(Effect.provideContext(context)))

  return { ...record, ended } satisfies Record
})

// The paper gather's requests: each host paced through its shared limiter,
// under a generic client name.
const http = Pace.hosts.pipe(Layer.provide(anonymous), Layer.provide(FetchHttpClient.layer))

// Inside Workers: PAPERS_DB, PAPERS and the PACE limiters. A Worker without
// the store binds no PaperGather Workflow, so this never runs there.
export const live = Layer.unwrap(
  Effect.promise(() => import("cloudflare:workers")).pipe(
    Effect.flatMap(({ env }) => {
      const { PAPERS_DB, PAPERS } = env

      if (PAPERS_DB === undefined || PAPERS === undefined)
        return Effect.die("The PaperGather Workflow needs PAPERS_DB and PAPERS")

      return Effect.succeed(
        Layer.mergeAll(
          D1Client.layer({ db: PAPERS_DB }).pipe(Layer.orDie),
          Bucket.binding(PAPERS),
          sources.pipe(Layer.provide(http)),
        ),
      )
    }),
  ),
)
