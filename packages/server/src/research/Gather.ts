// The paper gather: finds works on OpenAlex for each reviewed topic, checks
// each work's copies and licences, extracts admitted text, and writes the
// work into the paper store as `publication.ts` writes a corpus record. It
// runs the same in a Workflow and in a local runner, with no filesystem and
// no model call: the caller supplies the `Step` runner, the store's SQL
// client and bucket, and an HTTP client (docs/papers.md#gather).
import { Clock, Duration, Effect, Layer, Ref, Result, Schema, Struct } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { SqlClient } from "effect/sql"

import { Step, type StepFailed } from "../CatalogBuild.ts"
import { fingerprint } from "../fingerprint.ts"
import { type Gaps, gaps } from "../Pace.ts"
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

// What a run fetched, and the most it may fetch: requests to OpenAlex
// (search pages and batches of records), works gathered, PDFs downloaded and
// their bytes.
export interface Fetched {
  readonly requests: number
  readonly works: number
  readonly pdfs: number
  readonly bytes: number
}

const caps = ["requests", "works", "pdfs", "bytes"] as const

export type Cap = (typeof caps)[number]

const unlimited: Fetched = { requests: Infinity, works: Infinity, pdfs: Infinity, bytes: Infinity }

// The first cap `fetched` reached, if any.
const reached = (fetched: Fetched, limit: Fetched): Cap | null =>
  caps.find((cap) => fetched[cap] >= limit[cap]) ?? null

// A work's claim lapses after this long, well past a step's five-minute
// timeout, so a run that stopped without giving its claims back holds them
// no longer than that.
const lease = Duration.minutes(15)

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

const Found = Schema.Struct({
  next: Schema.NullOr(Schema.String),
  found: Schema.Int,
  skipped: Schema.Int,
  wanted: Schema.Array(Work.fields.id),
})

// What a gather step did with its batch: the works it gathered, and how
// many it left because the ledger already held their current record
// (`current`), another run held them (`held`) or a cap was reached
// (`waiting`); and what it fetched.
const Batch = Schema.Struct({
  gathered: Schema.Array(Gathered),
  current: Schema.Int,
  held: Schema.Int,
  waiting: Schema.Int,
  works: Schema.Int,
  pdfs: Schema.Int,
  bytes: Schema.Int,
})

// What a run did with one topic: the day it searched from (null for every
// year), the works its pages listed, the records that did not decode, the
// works the ledger already held unchanged, the works it asked for, those
// another run held or a cap left waiting, those that failed, whether a cap
// stopped it before its search or its works were done, and what failed.
export interface Searched {
  readonly key: string
  readonly query: string
  readonly since: string | null
  readonly found: number
  readonly skipped: number
  readonly unchanged: number
  readonly wanted: number
  readonly held: number
  readonly waiting: number
  readonly failed: number
  readonly capped: boolean
  readonly problem: string | null
}

// What a run did: per topic, what its search found and left; per work it
// asked for, the outcome; what it fetched; and the cap that stopped it, if
// one did. A failure names the work and the problem, never the paper's text.
export interface Report {
  readonly topics: ReadonlyArray<Searched>
  readonly works: ReadonlyArray<typeof Gathered.Type>
  readonly fetched: Fetched
  readonly stopped: Cap | null
}

// The ledger: one row per OpenAlex work the gather asked for. `hash` is the
// SHA-256 of the record's fields the gather reads, without `updated_date`,
// which OpenAlex moves whenever anything changes, citation counts included.
// Beside it, `work_claim` holds the run gathering each work right now, until
// its lease lapses. Only the gather writes them and nothing reads them but
// the gather.
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

  yield* sql`CREATE TABLE IF NOT EXISTS work_claim (
    work TEXT PRIMARY KEY,
    run TEXT NOT NULL,
    expires INTEGER NOT NULL
  )`
})

// Claims works for `run` in one statement: a work no run holds, one `run`
// holds already (a retried step), or one whose lease lapsed. Answers the
// works claimed; two runs never hold one work at once.
const claim = Effect.fnUntraced(function* (works: ReadonlyArray<string>, run: string) {
  const sql = yield* SqlClient.SqlClient
  const now = yield* Clock.currentTimeMillis

  if (works.length === 0) return new Set<string>()

  const rows = yield* sql`INSERT INTO work_claim (work, run, expires)
    SELECT value, ${run}, ${now + Duration.toMillis(lease)} FROM json_each(${JSON.stringify(works)})
    WHERE true
    ON CONFLICT (work) DO UPDATE SET run = excluded.run, expires = excluded.expires
    WHERE work_claim.run = excluded.run OR work_claim.expires <= ${now}
    RETURNING work`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ work: Schema.String }))),
    ),
  )

  return new Set(rows.map(({ work }) => work))
})

// Gives back `run`'s claims on these works.
const release = Effect.fnUntraced(function* (works: ReadonlyArray<string>, run: string) {
  const sql = yield* SqlClient.SqlClient

  if (works.length === 0) return

  yield* sql`DELETE FROM work_claim WHERE run = ${run}
    AND work IN (SELECT value FROM json_each(${JSON.stringify(works)}))`
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

// A topic as a run searches it: from the day it was last searched in full,
// or over every year.
interface Search {
  readonly key: string
  readonly topic: Topic
  readonly since: string | null
}

// One page of a topic's search, and which of its works the run wants.
const discover = Effect.fnUntraced(function* (
  search: Search,
  { cursor, limits }: { readonly cursor: string; readonly limits: Limits },
) {
  const openalex = yield* OpenAlex
  const { query, repository } = search.topic

  const page = yield* openalex.page(
    { query, repository, since: search.since },
    { cursor, size: limits.size },
  )

  const wanted = yield* wantedOf(page.works, limits)

  return Found.make({
    next: page.next,
    found: page.works.length,
    skipped: page.skipped,
    wanted: wanted.map((work) => work.id),
  })
})

// What one work of a batch came to: gathered, or left because the ledger
// already holds its current record, another run holds it, or a cap was
// reached.
const Done = Schema.TaggedUnion({
  Gathered: { gathered: Gathered },
  Current: {},
  Held: {},
  Waiting: {},
})

type Done = typeof Done.Type

// Gathers a batch of works the run wants, from their current records, while
// `left` allows: the works, PDFs and bytes the run may still fetch. It
// claims the batch first, and asks the ledger again under the claim, so a
// retried step or another run's finished work is not gathered twice. A
// work OpenAlex no longer lists records nothing: the next run asks again.
const batch = Effect.fnUntraced(function* (
  ids: ReadonlyArray<Work["id"]>,
  options: {
    readonly limits: Limits
    readonly left: Omit<Fetched, "requests">
    readonly run: string
  },
) {
  const { limits, left, run } = options
  const openalex = yield* OpenAlex
  const records = yield* openalex.works(ids)
  const claimed = yield* claim([...records.keys()], run)

  const due = new Set(
    (yield* wantedOf(
      [...records.values()].filter((work) => claimed.has(work.id)),
      limits,
    )).map((work) => work.id),
  )

  const used = yield* Ref.make({ works: 0, pdfs: 0, bytes: 0 })

  // Counts every PDF the batch downloads, and its bytes.
  const counted = OpenAlex.of({
    lookup: openalex.lookup,
    page: openalex.page,
    works: openalex.works,
    download: (copy) =>
      Ref.update(used, (count) => ({ ...count, pdfs: count.pdfs + 1 })).pipe(
        Effect.andThen(openalex.download(copy)),
        Effect.tap(({ bytes }) =>
          Ref.update(used, (count) => ({ ...count, bytes: count.bytes + bytes.length })),
        ),
      ),
  })

  // Takes one more work, if no cap is reached.
  const room = Ref.modify(used, (count) => {
    const free = count.works < left.works && count.pdfs < left.pdfs && count.bytes < left.bytes

    return [free, free ? { ...count, works: count.works + 1 } : count]
  })

  const one = Effect.fnUntraced(function* (id: Work["id"]) {
    const work = records.get(id)

    if (work === undefined)
      return Done.cases.Gathered.make({
        gathered: Gathered.make({
          work: id,
          title: "",
          outcome: Outcome.cases.Failed.make({
            operation: "metadata",
            problem: "OpenAlex no longer lists the work",
          }),
        }),
      })

    if (!claimed.has(id)) return Done.cases.Held.make({})

    if (!due.has(id)) return Done.cases.Current.make({})

    if (!(yield* room)) return Done.cases.Waiting.make({})

    return Done.cases.Gathered.make({
      gathered: yield* gatherOne(work).pipe(Effect.provideService(OpenAlex, counted)),
    })
  })

  const done: ReadonlyArray<Done> = yield* Effect.forEach(ids, one, {
    concurrency: limits.concurrency,
  })

  yield* release([...claimed], run)

  return Batch.make({
    gathered: done.flatMap((each) => (Done.guards.Gathered(each) ? [each.gathered] : [])),
    current: done.filter(Done.guards.Current).length,
    held: done.filter(Done.guards.Held).length,
    waiting: done.filter(Done.guards.Waiting).length,
    ...(yield* Ref.get(used)),
  })
})

const chunks = <A>(items: ReadonlyArray<A>, size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  )

const messageOf = (cause: unknown) =>
  Schema.is(PaperUnavailable)(cause) ? `${cause.operation}: ${String(cause.cause)}` : String(cause)

// What a step's work needs: the store and the sources.
type Services = OpenAlex | Licences | SqlClient.SqlClient | Bucket

// What a topic's steps share: the run's settings, the works it already
// asked for under an earlier topic or page (`seen`), and what it fetched so
// far (`fetched`), which each step adds to.
interface Scan {
  readonly index: number
  readonly limits: Limits
  readonly caps: Fetched
  readonly run: string
  readonly seen: Set<string>
  readonly fetched: { -readonly [K in keyof Fetched]: Fetched[K] }
}

// What a topic's steps found and left so far.
interface Tally {
  found: number
  skipped: number
  unchanged: number
  wanted: number
  held: number
  waiting: number
  capped: boolean
  readonly works: Array<typeof Gathered.Type>
  readonly problems: Array<string>
}

// Runs `effect` as the step `name`, saving its answer as JSON. A step's
// body runs on its own, so it carries the run's services.
const saved = <A, I>(
  schema: Schema.Codec<A, I>,
  name: string,
  effect: Effect.Effect<A, unknown, Services>,
) =>
  Effect.gen(function* () {
    const step = yield* Step
    const context = yield* Effect.context<Services>()
    const json = Schema.fromJsonString(schema)

    const answer = yield* step.run(
      name,
      effect.pipe(Effect.flatMap(Schema.encodeEffect(json)), Effect.provideContext(context)),
    )

    return yield* Schema.decodeEffect(json)(answer).pipe(Effect.orDie)
  })

// Gathers the works one page wanted, batch by batch, while no cap is
// reached. A batch that fails leaves its works unrecorded, so the next run
// asks for them again, and the topic goes on.
const gatherWanted = Effect.fnUntraced(function* (
  wanted: ReadonlyArray<Work["id"]>,
  { page, scan, tally }: { readonly page: number; readonly scan: Scan; readonly tally: Tally },
) {
  const { index, limits, caps: limit, run, seen, fetched } = scan

  for (const [part, ids] of chunks(wanted, limits.batch).entries()) {
    if (reached(fetched, limit) !== null) {
      tally.capped = true
      tally.waiting += ids.length
      continue
    }

    for (const id of ids) seen.add(id)
    fetched.requests += 1

    const left = {
      works: limit.works - fetched.works,
      pdfs: limit.pdfs - fetched.pdfs,
      bytes: limit.bytes - fetched.bytes,
    }

    const done = yield* Effect.result(
      saved(Batch, `gather ${index} ${page} ${part}`, batch(ids, { limits, left, run })),
    )

    if (Result.isFailure(done)) {
      tally.problems.push(`page ${page} batch ${part}: ${messageOf(done.failure.cause)}`)
      continue
    }

    const result = done.success
    tally.works.push(...result.gathered)
    tally.unchanged += result.current
    tally.held += result.held
    tally.waiting += result.waiting
    tally.capped ||= result.waiting > 0
    fetched.works += result.works
    fetched.pdfs += result.pdfs
    fetched.bytes += result.bytes
  }
})

// One topic, page by page, while no cap is reached. A page that fails ends
// the topic.
const gatherTopic = Effect.fnUntraced(function* (search: Search, scan: Scan) {
  const { index, limits, seen, fetched } = scan

  const tally: Tally = {
    found: 0,
    skipped: 0,
    unchanged: 0,
    wanted: 0,
    held: 0,
    waiting: 0,
    capped: false,
    works: [],
    problems: [],
  }

  let cursor: string | null = "*"

  for (let page = 1; page <= limits.pages && cursor !== null && !tally.capped; page += 1) {
    if (reached(fetched, scan.caps) !== null) {
      tally.capped = true
      break
    }

    fetched.requests += 1

    const found: Result.Result<typeof Found.Type, StepFailed> = yield* Effect.result(
      saved(Found, `discover ${index} ${page}`, discover(search, { cursor, limits })),
    )

    if (Result.isFailure(found)) {
      tally.problems.push(`page ${page}: ${messageOf(found.failure.cause)}`)
      break
    }

    const wanted = found.success.wanted.filter((id) => !seen.has(id))
    tally.found += found.success.found
    tally.skipped += found.success.skipped
    tally.unchanged += found.success.found - found.success.wanted.length
    tally.wanted += wanted.length
    cursor = found.success.next

    yield* gatherWanted(wanted, { page, scan, tally })
  }

  const { works, problems, ...totals } = tally

  return {
    topic: {
      key: search.key,
      query: search.topic.query,
      since: search.since,
      ...totals,
      failed: works.filter(({ outcome }) => Outcome.guards.Failed(outcome)).length,
      problem: problems.length === 0 ? null : problems.join("; "),
    } satisfies Searched,
    works,
  }
})

// The reviewed topic file.
const reviewed = Schema.decodeUnknownEffect(Topics)(file).pipe(Effect.map(({ topics }) => topics))

// A topic's key: the hash of what its search asks, so editing a query makes
// a new topic.
const keyOf = (topic: Topic) =>
  fingerprint(JSON.stringify([topic.query, topic.repository === true]))

// Gathers every topic of the reviewed topic file, or the topics given. A
// run asks only for works the ledger says changed or failed under the
// attempt limit, so a run after an unchanged one fetches no copy. A topic
// with a day in `since` asks only for works published from that day;
// topics without one go first, then the longest unsearched, so a
// run that stops at a cap leaves the most recently searched topics for the
// next. `run` names who claims the works, a fresh id by default.
export const run = Effect.fn("Papers.gather")(function* (
  options: {
    readonly topics?: ReadonlyArray<Topic>
    readonly since?: ReadonlyMap<string, string>
    readonly limits?: Partial<Limits>
    readonly caps?: Partial<Fetched>
    readonly run?: string
  } = {},
) {
  const step = yield* Step
  const settings = { ...defaults, ...options.limits }
  const limit = { ...unlimited, ...options.caps }
  const claimant = options.run ?? (yield* Effect.sync(() => crypto.randomUUID()))
  const topics = options.topics ?? (yield* reviewed)

  const searches = (yield* Effect.forEach(topics, (topic) =>
    Effect.map(keyOf(topic), (key) => ({ key, topic, since: options.since?.get(key) ?? null })),
  )).toSorted((a, b) => (a.since ?? "").localeCompare(b.since ?? ""))

  const context = yield* Effect.context<SqlClient.SqlClient>()
  yield* step.run("tables", Effect.andThen(tables, ledger).pipe(Effect.provideContext(context)))

  const seen = new Set<string>()
  const fetched = { requests: 0, works: 0, pdfs: 0, bytes: 0 }
  const results: Array<Searched> = []
  const works: Array<typeof Gathered.Type> = []

  for (const [index, search] of searches.entries()) {
    const done = yield* gatherTopic(search, {
      index,
      limits: settings,
      caps: limit,
      run: claimant,
      seen,
      fetched,
    })

    results.push(done.topic)
    works.push(...done.works)
  }

  return {
    topics: results,
    works,
    fetched,
    stopped: results.some(({ capped }) => capped) ? reached(fetched, limit) : null,
  } satisfies Report
})

// A generic client name, without a contact address or API key.
const named = HttpClient.mapRequest(HttpClientRequest.setHeader("user-agent", "papers-gather/1.0"))

// The caller's HTTP client, naming the client generically.
export const anonymous = Layer.effect(
  HttpClient.HttpClient,
  Effect.map(HttpClient.HttpClient, named),
)

// Waits between requests to one host in this process, so no publisher sees
// more than one request per gap from us (`gaps` in Pace.ts), and names the
// client generically. Other hosts go on meanwhile. A Workflow paces through
// the shared limiters instead (`Pace.hosts`).
export const paced = (options: Gaps = gaps) =>
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
        named,
        HttpClient.mapRequestEffect((request) =>
          slot(new URL(request.url).host).pipe(Effect.as(request)),
        ),
      )
    }),
  )

// OpenAlex and the licence pages over the caller's HTTP client.
export const sources = Layer.mergeAll(OpenAlex.layer, Licences.layer)
