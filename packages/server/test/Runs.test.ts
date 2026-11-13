import { assert, beforeEach, describe, expect, it } from "@effect/vitest"
import { reset } from "cloudflare:test"
import { Deferred, Duration, Effect, Fiber, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { SqlClient } from "effect/sql"

import type { Work } from "../src/research/archive.ts"
import { Bucket } from "../src/research/Bucket.ts"
import type { Fetched, Topic } from "../src/research/Gather.ts"
import { paced, sources } from "../src/research/Gather.ts"
import { Caps, gather } from "../src/research/Runs.ts"
import { papersBucket, papersDb } from "./papers.ts"
import { pdf } from "./pdf.ts"
import { workflow } from "./workflow.ts"
import { copy, work } from "./works.ts"

// The PaperGather Workflow's work inside workerd, against PAPERS_DB and
// PAPERS, with OpenAlex and the publishers faked at the HTTP client and a
// fake Workflows step runner that saves, replays, loses and crashes steps.

beforeEach(() => reset())

const wages: Topic = { area: "labour", query: "minimum wage employment" }
const pensions: Topic = { area: "pensions", query: "pension reform employment" }

// Leaves every publisher's answer to the fixture PDF.
const served: (url: string) => Effect.Effect<Response | undefined> = () => Effect.undefined

// OpenAlex and the publishers on the wire. Each query lists its works in
// order, paged by `per-page`, with no cursor after its last page; a search
// with `from_updated_date` lists only the works updated from that day, as
// OpenAlex does. A publisher serves the fixture PDF unless `respond`
// answers first.
const world = (listed: Readonly<globalThis.Record<string, ReadonlyArray<Work>>>) => {
  const urls: Array<string> = []
  const records = new Map(Object.values(listed).flatMap((works) => works.map((w) => [w.id, w])))

  const lists = new Map(
    Object.entries(listed).map(([query, works]) => [query, works.map((w) => w.id)]),
  )

  let respond = served

  const openalex = (url: URL) => {
    const filter = url.searchParams.get("filter") ?? ""

    if (filter.startsWith("ids.openalex:")) {
      const ids = filter.slice("ids.openalex:".length).split("|")

      return Response.json({
        meta: {},
        results: ids.flatMap((id) => {
          const record = records.get(`https://openalex.org/${id}`)

          return record === undefined ? [] : [record]
        }),
      })
    }

    const since = /from_updated_date:([^,]+)/.exec(filter)?.[1]
    const size = Number(url.searchParams.get("per-page"))
    const cursor = url.searchParams.get("cursor")
    const index = cursor === "*" ? 0 : Number(cursor)

    const matching = (lists.get(url.searchParams.get("search") ?? "") ?? []).flatMap((id) => {
      const record = records.get(id)

      return record !== undefined && (since === undefined || record.updated_date >= since)
        ? [record]
        : []
    })

    return Response.json({
      meta: { next_cursor: (index + 1) * size < matching.length ? String(index + 1) : null },
      results: matching.slice(index * size, (index + 1) * size),
    })
  }

  const http = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.gen(function* () {
        urls.push(request.url)
        const url = new URL(request.url)

        const response =
          url.host === "api.openalex.org"
            ? openalex(url)
            : ((yield* respond(request.url)) ?? new Response(pdf()))

        return HttpClientResponse.fromWeb(request, response)
      }),
    ),
  )

  return {
    // URLs requested from `from` on, in order.
    urls: (from = 0) => urls.slice(from),
    // The day each search asked from, in order; null for every year.
    searches: (from = 0) =>
      urls.slice(from).flatMap((url) => {
        const params = new URL(url).searchParams
        const query = params.get("search")

        return query === null
          ? []
          : [[query, /from_updated_date:([^,]+)/.exec(params.get("filter") ?? "")?.[1] ?? null]]
      }),
    // OpenAlex adds a work to a query's results, or updates its record.
    list: (query: string, record: Work) => {
      records.set(record.id, record)
      const ids = lists.get(query) ?? []

      if (!ids.includes(record.id)) lists.set(query, [...ids, record.id])
    },
    respond: (next: (url: string) => Effect.Effect<Response | undefined>) => {
      respond = next
    },
    http,
  }
}

const pdfs = (urls: ReadonlyArray<string>) => urls.filter((url) => url.endsWith(".pdf"))

// One instance's run over `topics`, started at `started`, with its own
// saved steps unless a test gives them.
const running = (
  place: ReturnType<typeof world>,
  options: {
    readonly run: string
    readonly started: string
    readonly topics?: ReadonlyArray<Topic>
    readonly steps?: ReturnType<typeof workflow>
    readonly caps?: Partial<Fetched>
  },
) => {
  const { run, started, topics = [wages], steps = workflow(), caps } = options

  return gather({ run, started }, { topics }).pipe(
    Effect.provide(
      Layer.mergeAll(
        steps.layer,
        sources.pipe(
          Layer.provide(paced({ gap: Duration.zero, hosts: {} })),
          Layer.provide(place.http),
        ),
        papersDb,
        Bucket.binding(papersBucket),
      ),
    ),
    Effect.provideService(Caps, { ...Caps.defaultValue(), ...caps }),
  )
}

// What the store, the ledger and the claims hold, and every object.
const store = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const objects = yield* Effect.promise(() => papersBucket.list())

  return {
    paper: yield* sql`SELECT * FROM paper ORDER BY id`,
    copy: yield* sql`SELECT * FROM copy ORDER BY id`,
    version: yield* sql`SELECT * FROM version ORDER BY id`,
    ledger: yield* sql`SELECT * FROM work_gathered ORDER BY work`,
    claims: yield* sql`SELECT * FROM work_claim ORDER BY work`,
    objects: objects.objects.map(({ key, etag }) => ({ key, etag })),
  }
}).pipe(Effect.provide(papersDb))

// The rows the run records hold.
const records = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  return {
    runs: yield* sql`SELECT run, seen, admitted, unchanged, failed, held, waiting, stopped
      FROM gather_run ORDER BY started`,
    topics: yield* sql`SELECT run, query, since, complete FROM gather_topic ORDER BY run, query`,
  }
}).pipe(Effect.provide(papersDb))

// The counts of a run's record.
const counts = ({
  seen,
  admitted,
  metadata,
  unchanged,
  failed,
  held,
  waiting,
}: Effect.Success<ReturnType<typeof gather>>) => ({
  seen,
  admitted,
  metadata,
  unchanged,
  failed,
  held,
  waiting,
})

const monday = (day: number) => `2026-11-${String(day).padStart(2, "0")}T03:00:00.000Z`

// Work `n`'s record, changed only in a way the gather does not read, as a
// new citation count moves `updated_date`.
const touched = (n: number, day: number) =>
  work(n, { updated_date: `2026-11-${String(day).padStart(2, "0")}T12:00:00` })

describe("the PaperGather Workflow", () => {
  it.effect("asks for works updated since the last run and gathers a new one once", () => {
    const place = world({ [wages.query]: [work(1), work(2)] })

    return Effect.gen(function* () {
      const first = yield* running(place, { run: "run-1", started: monday(2) })

      expect(place.searches()).toEqual([[wages.query, null]])
      expect(counts(first)).toMatchObject({ seen: 2, admitted: 2, unchanged: 0 })

      // OpenAlex adds a work, and moves another's updated date alone.
      place.list(wages.query, work(3, { updated_date: "2026-11-05T00:00:00" }))
      place.list(wages.query, touched(1, 6))
      const from = place.urls().length

      const second = yield* running(place, { run: "run-2", started: monday(9) })

      expect(place.searches(from)).toEqual([[wages.query, "2026-11-02"]])
      expect(counts(second)).toEqual({
        seen: 2,
        admitted: 1,
        metadata: 0,
        unchanged: 1,
        failed: 0,
        held: 0,
        waiting: 0,
      })
      expect(pdfs(place.urls(from))).toEqual([copy(3).pdf_url])

      // Nothing new upstream: the new work's citations moved, nothing else.
      place.list(wages.query, touched(3, 10))
      const before = yield* store
      const again = place.urls().length

      const third = yield* running(place, { run: "run-3", started: monday(16) })

      expect(place.searches(again)).toEqual([[wages.query, "2026-11-09"]])
      expect(counts(third)).toMatchObject({ seen: 1, admitted: 0, unchanged: 1 })
      expect(pdfs(place.urls(again))).toEqual([])
      expect(yield* store).toEqual(before)
      expect((yield* records).runs).toHaveLength(3)
    })
  })

  it.effect("backfills a topic new to the topic file first, over every year", () => {
    const place = world({ [wages.query]: [work(1)], [pensions.query]: [work(2), work(1)] })

    return Effect.gen(function* () {
      yield* running(place, { run: "run-1", started: monday(2) })
      const from = place.urls().length

      const second = yield* running(place, {
        run: "run-2",
        started: monday(9),
        topics: [wages, pensions],
      })

      expect(place.searches(from)).toEqual([
        [pensions.query, null],
        [wages.query, "2026-11-02"],
      ])
      expect(pdfs(place.urls(from))).toEqual([copy(2).pdf_url])
      expect(
        second.topics.map(({ query, seen, wanted, complete }) => [query, seen, wanted, complete]),
      ).toEqual([
        [pensions.query, 2, 1, true],
        [wages.query, 0, 0, true],
      ])
    })
  })

  it.effect("stops at a cap and leaves the rest of its topics for the next run", () => {
    const place = world({
      [wages.query]: [work(1), work(2), work(3)],
      [pensions.query]: [work(4)],
    })

    return Effect.gen(function* () {
      const topics = [wages, pensions]

      const capped = yield* running(place, {
        run: "run-1",
        started: monday(2),
        topics,
        caps: { works: 2 },
      })

      expect(capped.stopped).toBe("works")
      expect(counts(capped)).toMatchObject({ admitted: 2, waiting: 1 })
      expect(capped.topics.map(({ query, complete }) => [query, complete])).toEqual([
        [wages.query, false],
        [pensions.query, false],
      ])
      expect(place.searches()).toEqual([[wages.query, null]])
      expect(pdfs(place.urls())).toHaveLength(2)

      // With no request left, a run reads one search page and nothing else.
      const from = place.urls().length

      const starved = yield* running(place, {
        run: "run-2",
        started: monday(3),
        topics,
        caps: { requests: 1 },
      })

      expect(starved.stopped).toBe("requests")
      expect(place.urls(from)).toHaveLength(1)

      // The next run searches both topics over every year and gathers the
      // rest, once.
      const rest = place.urls().length
      const next = yield* running(place, { run: "run-3", started: monday(9), topics })

      expect(place.searches(rest)).toEqual([
        [wages.query, null],
        [pensions.query, null],
      ])
      expect(pdfs(place.urls(rest)).toSorted()).toEqual([copy(3).pdf_url, copy(4).pdf_url])
      expect(next.stopped).toBeNull()
      expect(counts(next)).toMatchObject({ admitted: 2, unchanged: 2, waiting: 0 })
      expect((yield* records).topics).toContainEqual({
        run: "run-3",
        query: wages.query,
        since: null,
        complete: 1,
      })
    })
  })

  it.effect("records a failed host's work and searches its topic over again next run", () => {
    const place = world({ [wages.query]: [work(1), work(2)] })

    return Effect.gen(function* () {
      place.respond((url) =>
        Effect.succeed(
          url === copy(1).pdf_url ? new Response("unavailable", { status: 503 }) : undefined,
        ),
      )

      const failed = yield* running(place, { run: "run-1", started: monday(2) })

      expect(counts(failed)).toMatchObject({ admitted: 1, failed: 1 })
      expect(failed.reasons.failed).toMatchObject([{ work: work(1).id, operation: "download" }])
      expect(failed.topics[0]?.complete).toBe(false)

      place.respond(served)
      const from = place.urls().length
      const retried = yield* running(place, { run: "run-2", started: monday(9) })

      expect(place.searches(from)).toEqual([[wages.query, null]])
      expect(pdfs(place.urls(from))).toEqual([copy(1).pdf_url])
      expect(counts(retried)).toMatchObject({ admitted: 1, unchanged: 1, failed: 0 })

      const last = place.urls().length
      yield* running(place, { run: "run-3", started: monday(16) })

      expect(place.searches(last)).toEqual([[wages.query, "2026-11-09"]])
    })
  })

  it.effect("resumes from its saved steps, and gathers no completed work again", () => {
    const place = world({ [wages.query]: [work(1)], [pensions.query]: [work(2)] })

    return Effect.gen(function* () {
      const topics = [wages, pensions]

      // The first batch's result is lost once, and the instance stops at the
      // second topic's batch.
      const steps = workflow({ lose: "gather 0 1 0", crash: "gather 1 1 0" })

      const fiber = yield* Effect.forkChild(
        running(place, { run: "run-1", started: monday(2), topics, steps }),
      )

      yield* steps.crashed
      yield* Fiber.interrupt(fiber)

      expect(pdfs(place.urls())).toEqual([copy(1).pdf_url])
      expect(steps.calls("gather 0")).toBe(2)

      // Restarted from the step that failed: the plan, the first topic and
      // the second topic's search replay.
      steps.revive()
      const from = place.urls().length
      const resumed = yield* running(place, { run: "run-1", started: monday(2), topics, steps })

      expect(place.searches(from)).toEqual([])
      expect(pdfs(place.urls(from))).toEqual([copy(2).pdf_url])
      expect(steps.calls("discover")).toBe(2)
      expect(resumed.topics.map(({ complete }) => complete)).toEqual([true, true])
      expect((yield* records).runs).toMatchObject([{ run: "run-1", admitted: 1, unchanged: 1 }])
    })
  })

  it.effect("never gathers a work another run is gathering", () => {
    const place = world({ [wages.query]: [work(1)] })

    return Effect.gen(function* () {
      const asked = yield* Deferred.make<void>()
      const open = yield* Deferred.make<void>()

      // The first run's PDF request waits until the test opens it.
      place.respond((url) =>
        url === copy(1).pdf_url
          ? Deferred.succeed(asked, undefined).pipe(
              Effect.andThen(Deferred.await(open)),
              Effect.as(undefined),
            )
          : Effect.undefined,
      )

      const first = yield* Effect.forkChild(running(place, { run: "run-a", started: monday(2) }))

      yield* Deferred.await(asked)
      place.respond(served)

      const second = yield* running(place, { run: "run-b", started: monday(2) })

      expect(counts(second)).toMatchObject({ admitted: 0, held: 1 })
      expect(second.topics[0]?.complete).toBe(false)

      yield* Deferred.succeed(open, undefined)
      const done = yield* Fiber.join(first)

      expect(counts(done)).toMatchObject({ admitted: 1, held: 0 })
      expect(pdfs(place.urls())).toEqual([copy(1).pdf_url])

      const { claims } = yield* store

      assert(claims.length === 0, "Expected every claim given back")
    })
  })
})
