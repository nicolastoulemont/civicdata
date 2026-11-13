import { assert, beforeEach, describe, expect, it } from "@effect/vitest"
import { reset } from "cloudflare:test"
import { Duration, Effect, Fiber, Layer, Predicate, Redacted, Schema } from "effect"
import type { NonEmptyReadonlyArray } from "effect/Array"
import { HttpClient, HttpClientResponse } from "effect/http"
import { SqlClient } from "effect/sql"
import { TestClock } from "effect/testing"

import { workflow as fake } from "../../tests/workflow.ts"
import { fingerprint } from "../../utils/fingerprint.ts"
import { Annotate, Instances, Limits, Outcome, Params, Report, retries } from "../Annotate.ts"
import { model, Settings } from "../annotation.ts"
import { Annotator } from "../Annotator.ts"
import type { Passage } from "../archive.ts"
import { Demand } from "../Demand.ts"
import { Held, Papers } from "../Papers.ts"
import { annotationKey, objectsOf, PaperId } from "../store.ts"
import { bibliography, body, papersBucket, papersDb, publish } from "./papers.ts"

beforeEach(() => reset())

const key = "sk-test-annotate"

// A paper's text, distinct per `n`: one sentence on page 1 with the study's
// country and period, one on page 4 with its result.
const textOf = (n: number): NonEmptyReadonlyArray<typeof Passage.Type> => [
  {
    page: 1,
    part: 0,
    text: `Training participation rose in France between 2010 and 2020 in sample ${n}.`,
  },
  { page: 4, part: 0, text: `Training participation was associated with employment ${n}.` },
]

// Paper `n`'s annotation key under `rubric`.
const keyFor = (n: number, rubric = "research-3") =>
  Effect.flatMap(fingerprint(JSON.stringify(textOf(n))), (text) =>
    annotationKey({ text, extraction: "unpdf-2.1.0/300-words", model, rubric }),
  )

// Publishes paper `n` with no annotation, or with `text` shared with another.
const paper = (n: number, text = textOf(n)) =>
  publish({
    paper: bibliography({ id: PaperId.make(String(n).repeat(64)) }),
    passages: text,
    annotation: null,
  }).pipe(Effect.provide(papersDb))

// The scope the fake model selects, as JSON on the wire: page 1 for the
// country and period, page 4 for the result and the design.
const selected = `{
  "population": null,
  "excerpts": [{ "page": 4, "part": 0, "sentence": 0 }],
  "countries": [{ "code": "FRA", "evidence": { "page": 1, "part": 0, "sentence": 0 } }],
  "regions": [],
  "periods": [{ "from": 2010, "to": 2020, "evidence": { "page": 1, "part": 0, "sentence": 0 } }],
  "design": { "_tag": "Association", "evidence": { "page": 4, "part": 0, "sentence": 0 } }
}`

const Asked = Schema.fromJsonString(
  Schema.Struct({ questions: Schema.Array(Schema.Struct({ name: Schema.String })) }),
)

type Answer = "Ok" | "Malformed" | "Down"

// How each API answers.
interface Answers {
  scope: Answer
  labels: Answer
}

// OpenAI on the wire: the Responses API selects the scope, the Decisions API
// labels each question. Each answers as its state says, and keeps the URL
// and Authorization header of every request.
const provider = () => {
  const state: Answers = { scope: "Ok", labels: "Ok" }
  const requests: Array<string> = []

  const respond = (url: string, sent: string): Response => {
    const answer = url.endsWith("/responses") ? state.scope : state.labels

    if (answer === "Down") return new Response("unavailable", { status: 503 })

    if (url.endsWith("/decisions")) {
      if (answer === "Malformed") return Response.json({ answers: [{ name: "1:0" }] })

      return Response.json({
        answers: Schema.decodeSync(Asked)(sent).questions.map(({ name }) => ({
          type: "choice",
          name,
          choice: name === "1:0" ? "Description" : "Association",
          confidence: 0.95,
        })),
        usage: { input_tokens: 900, output_tokens: 100 },
      })
    }

    return Response.json({
      id: "resp_1",
      object: "response",
      created_at: 0,
      status: "completed",
      model,
      output: [
        {
          type: "message",
          id: "msg_1",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: answer === "Malformed" ? "not json" : selected,
              annotations: [],
            },
          ],
        },
      ],
      usage: {
        input_tokens: 1500,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 500,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 2000,
      },
    })
  }

  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push(request.url)

      const sent = Predicate.isTagged(request.body, "Uint8Array")
        ? new TextDecoder().decode(request.body.body)
        : ""

      return HttpClientResponse.fromWeb(request, respond(request.url, sent))
    }),
  )

  const count = (path: string) => requests.filter((url) => url.endsWith(path)).length

  return {
    state,
    scopes: () => count("/responses"),
    labels: () => count("/decisions"),
    layer: Annotator.openAi(Redacted.make(key)).pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    ),
  }
}

// The fake Workflows step runner, with the Annotate Workflow's retries.
const workflow = (options: Parameters<typeof fake>[0] = {}) => fake({ ...options, config: retries })

// The Workflow API, which knows the instances in `live` as running and every
// other as ended.
const instances = () => {
  const live = new Set<string>()

  return {
    live,
    layer: Layer.succeed(
      Instances,
      Instances.of({ ended: (run) => Effect.succeed(!live.has(run)) }),
    ),
  }
}

// The real demand record in the test's DB, counting how often a run reads it.
const demand = () => {
  let reads = 0

  return {
    reads: () => reads,
    layer: Layer.effect(
      Demand,
      Effect.gen(function* () {
        const real = yield* Demand

        return Demand.of({
          ...real,
          since: (time) =>
            Effect.suspend(() => {
              reads += 1

              return real.since(time)
            }),
        })
      }),
    ).pipe(Layer.provide(Demand.layer)),
  }
}

interface Run {
  readonly run?: string
  readonly steps?: ReturnType<typeof workflow>
  readonly settings?: typeof Settings.Service
  readonly limits?: Partial<typeof Limits.Service>
}

// One Workflow instance's run of `params`, against the test's D1, R2,
// provider, Workflow API and demand.
const annotating = (
  world: {
    provider: ReturnType<typeof provider>
    instances: ReturnType<typeof instances>
    demand: ReturnType<typeof demand>
  },
  params: Params,
  {
    run = "run-1",
    steps = workflow(),
    settings = { model, rubric: "research-3" },
    limits,
  }: Run = {},
) =>
  Effect.gen(function* () {
    const annotate = yield* Annotate

    return yield* annotate.run(params, run)
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        steps.layer,
        Annotate.make(papersBucket).pipe(
          Layer.provide(papersDb),
          Layer.provide(world.provider.layer),
          Layer.provide(world.instances.layer),
          Layer.provide(world.demand.layer),
        ),
      ),
    ),
    Effect.provideService(Settings, settings),
    Effect.provideService(Limits, { ...Limits.defaultValue(), ...limits }),
  )

const annotate = (...versions: NonEmptyReadonlyArray<string>) =>
  Params.cases.Annotate.make({ versions: [...versions] })

const world = () => ({ provider: provider(), instances: instances(), demand: demand() })

const daily = Params.cases.Demand.make({})

// Questions asking for `versions`, one call each.
const ask = (...versions: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const record = yield* Demand

    yield* Effect.forEach(versions, (version) => record.record([version]), { discard: true })
  }).pipe(Effect.provide(Demand.layer))

// What PAPERS_DB holds for a key, and every run's records.
const keyState = (annotation: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const rows = yield* sql<{
      state: string
      run: string | null
      attempts: number
      reason: string | null
    }>`SELECT state, run, attempts, reason FROM annotation_key WHERE key = ${annotation}`

    return rows[0] ?? null
  }).pipe(Effect.provide(papersDb))

const records = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  return yield* sql<{
    run: string
    version: string
    outcome: string
    attempts: number | null
    requests: number
    input_tokens: number | null
    output_tokens: number | null
    started_at: string | null
    ended_at: string
  }>`SELECT * FROM annotation_run ORDER BY run, version`
}).pipe(Effect.provide(papersDb))

const read = (id: string) =>
  Effect.gen(function* () {
    const held = yield* (yield* Papers).read(PaperId.make(id))

    assert(Held.guards.Text(held), "Expected the paper's text")

    return held
  }).pipe(Effect.provide(Papers.make(papersBucket).pipe(Layer.provide(papersDb))))

const annotated = (version: string, outcome: Outcome) => Report.make({ version, outcome })

// What a run did with each listed version, in words.
const done = (results: ReadonlyArray<Report>) =>
  results.map(({ outcome }) =>
    Outcome.match(outcome, {
      Annotated: () => "Annotated",
      Failed: ({ stage, reason }) => `Failed at ${stage}: ${reason}`,
      Skipped: ({ reason }) => `Skipped: ${reason}`,
      NotStarted: () => "NotStarted",
    }),
  )

const keyOf = (results: ReadonlyArray<Report>) => {
  const outcome = results[0]?.outcome

  assert(outcome !== undefined && Outcome.guards.Annotated(outcome), "Expected an annotation")

  return outcome.key
}

describe("the Annotate Workflow", () => {
  it.effect("annotates a paper, records the run and serves the annotation through the reader", () =>
    Effect.gen(function* () {
      const test = world()
      const { paper: id, version } = yield* paper(1)
      const results = yield* annotating(test, annotate(version))

      expect(results).toEqual([
        annotated(version, Outcome.cases.Annotated.make({ key: keyOf(results) })),
      ])
      expect([test.provider.scopes(), test.provider.labels()]).toEqual([1, 1])
      expect(yield* keyState(keyOf(results))).toEqual({
        state: "Ready",
        run: "run-1",
        attempts: 0,
        reason: null,
      })

      const held = yield* read(id)

      expect(held.annotation?.scope.countries).toEqual([
        { code: "FRA", evidence: { page: 1, quote: textOf(1)[0].text } },
      ])
      expect(held.annotation?.labels.map(({ category }) => category)).toEqual([
        "Description",
        "Association",
      ])
      expect(held.annotation?.excerpts).toEqual([
        { page: 4, quote: textOf(1)[1]?.text, category: "Association", confidence: 0.95 },
      ])

      const [record] = yield* records

      expect(record).toMatchObject({
        run: "run-1",
        version,
        attempts: 0,
        requests: 2,
        input_tokens: 2400,
        output_tokens: 600,
      })
      expect(record?.started_at).not.toBeNull()

      // No row the Workflow wrote holds the API key.
      const sql = yield* SqlClient.SqlClient.pipe(Effect.provide(papersDb))

      for (const table of ["annotation_key", "annotation_stage", "annotation_run", "annotation"]) {
        const rows = yield* sql`SELECT * FROM ${sql(table)}`.pipe(Effect.provide(papersDb))

        expect(JSON.stringify(rows)).not.toContain(key)
      }
    }),
  )

  it.effect(
    "keeps a saved scope when classification fails, for the run's retries and the next run",
    () =>
      Effect.gen(function* () {
        const test = world()
        const { version } = yield* paper(1)
        const steps = workflow()

        test.provider.state.labels = "Down"

        const failed = yield* annotating(test, annotate(version), { steps })

        expect(done(failed)).toEqual(["Failed at Labels: Provider"])
        // One call and three retries of the classifying step, one scope call.
        expect([steps.calls("labels"), steps.calls("scope")]).toEqual([4, 1])
        expect([test.provider.scopes(), test.provider.labels()]).toEqual([1, 4])

        test.provider.state.labels = "Ok"

        const results = yield* annotating(test, annotate(version), { run: "run-2" })

        expect(done(results)).toEqual(["Annotated"])
        expect([test.provider.scopes(), test.provider.labels()]).toEqual([1, 5])
        expect(yield* keyState(keyOf(results))).toMatchObject({ state: "Ready", attempts: 1 })
      }),
  )

  it.effect(
    "fails malformed output without a step retry, and abandons a key after three runs",
    () =>
      Effect.gen(function* () {
        const test = world()
        const { version } = yield* paper(1)
        const steps = workflow()

        test.provider.state.scope = "Malformed"

        const first = yield* annotating(test, annotate(version), { steps })

        expect(done(first)).toEqual(["Failed at Scope: Invalid"])
        expect(steps.calls("scope")).toBe(1)

        test.provider.state.scope = "Ok"
        test.provider.state.labels = "Malformed"

        for (const run of ["run-2", "run-3"]) {
          const result = yield* annotating(test, annotate(version), { run })

          expect(done(result)).toEqual(["Failed at Labels: Invalid"])
        }

        // The scope saved in the second run served the third.
        expect([test.provider.scopes(), test.provider.labels()]).toEqual([2, 2])

        const [abandoned] = yield* records.pipe(
          Effect.map((rows) => rows.filter((row) => row.run === "run-3")),
        )

        expect(abandoned?.attempts).toBe(3)

        test.provider.state.labels = "Ok"

        const [skipped] = yield* annotating(test, annotate(version), { run: "run-4" })

        expect(skipped?.outcome).toEqual(Outcome.cases.Skipped.make({ reason: "Abandoned" }))
        expect([test.provider.scopes(), test.provider.labels()]).toEqual([2, 2])

        const retried = yield* annotating(
          test,
          Params.cases.Annotate.make({ versions: [version], retry: true }),
          { run: "run-5" },
        )

        expect(done(retried)).toEqual(["Annotated"])
        expect(yield* keyState(keyOf(retried))).toMatchObject({ state: "Ready", attempts: 0 })
      }),
  )

  it.effect("skips withdrawn and stale input without an attempt or a model call", () =>
    Effect.gen(function* () {
      const test = world()
      const sql = yield* SqlClient.SqlClient.pipe(Effect.provide(papersDb))
      const gone = "f".repeat(64)

      expect(yield* annotating(test, annotate(gone))).toEqual([
        annotated(gone, Outcome.cases.Skipped.make({ reason: "Withdrawn" })),
      ])

      // Withdrawn after the run claimed its key, in the store's order.
      const first = yield* paper(1)

      const withdrawing = workflow({
        before: async (name) => {
          if (!name.startsWith("load")) return

          await Effect.runPromise(
            Effect.gen(function* () {
              yield* sql`UPDATE paper SET active = NULL WHERE id = ${first.paper}`
              yield* sql`DELETE FROM version WHERE id = ${first.version}`
              yield* sql`UPDATE copy SET admission = 'Withdrawn', withdrawal = 'Rights'
                WHERE id = ${first.copy}`
            }).pipe(Effect.provide(papersDb)),
          )
          await papersBucket.delete(objectsOf(first.version).text)
        },
      })

      const [withdrawn] = yield* annotating(test, annotate(first.version), {
        run: "run-2",
        steps: withdrawing,
      })

      expect(withdrawn?.outcome).toEqual(Outcome.cases.Skipped.make({ reason: "Withdrawn" }))

      // Its text changed after the run loaded it.
      const second = yield* paper(2)

      const changing = workflow({
        before: async (name) => {
          if (!name.startsWith("scope")) return

          await Effect.runPromise(
            sql`UPDATE version SET text = ${"e".repeat(64)} WHERE id = ${second.version}`.pipe(
              Effect.provide(papersDb),
            ),
          )
        },
      })

      const [stale] = yield* annotating(test, annotate(second.version), {
        run: "run-3",
        steps: changing,
      })

      expect(stale?.outcome).toEqual(Outcome.cases.Skipped.make({ reason: "Stale" }))
      expect([test.provider.scopes(), test.provider.labels()]).toEqual([0, 0])

      const states = yield* sql<{ state: string; attempts: number; reason: string }>`
        SELECT state, attempts, reason FROM annotation_key ORDER BY reason
      `.pipe(Effect.provide(papersDb))

      expect(states).toEqual([
        { state: "Failed", attempts: 0, reason: "Stale" },
        { state: "Failed", attempts: 0, reason: "Withdrawn" },
      ])
    }),
  )

  it.effect("annotates each key once when two runs' lists overlap", () =>
    Effect.gen(function* () {
      const test = world()
      const [one, two, three] = yield* Effect.all([paper(1), paper(2), paper(3)])

      test.instances.live.add("run-a")
      test.instances.live.add("run-b")

      const [a, b] = yield* Effect.all(
        [
          annotating(test, annotate(one.version, two.version), { run: "run-a" }),
          annotating(test, annotate(two.version, three.version), { run: "run-b" }),
        ],
        { concurrency: "unbounded" },
      )

      expect([test.provider.scopes(), test.provider.labels()]).toEqual([3, 3])

      const shared = [...a, ...b].filter(({ version }) => version === two.version)

      expect(done(shared)).toContain("Annotated")

      for (const { paper: id } of [one, two, three])
        expect((yield* read(id)).annotation).not.toBeNull()
    }),
  )

  it.effect(
    "annotates a key once when a list holds it twice, directly and through shared text",
    () =>
      Effect.gen(function* () {
        const test = world()
        const first = yield* paper(1)
        const copy = yield* paper(2, textOf(1))

        const results = yield* annotating(
          test,
          annotate(first.version, first.version, copy.version),
        )

        expect(results.map(({ version }) => version)).toEqual([first.version, copy.version])
        expect(done(results)).toEqual(["Annotated", "Annotated"])
        expect([test.provider.scopes(), test.provider.labels()]).toEqual([1, 1])
        expect((yield* read(copy.paper)).annotation).toEqual((yield* read(first.paper)).annotation)
      }),
  )

  it.effect("claims again when Workflows lost the result of a claim whose write landed", () =>
    Effect.gen(function* () {
      const test = world()
      const { version } = yield* paper(1)
      const steps = workflow({ lose: `claim ${yield* keyFor(1)}` })

      const result = yield* annotating(test, annotate(version), { steps })

      expect(done(result)).toEqual(["Annotated"])
      expect(steps.calls("claim")).toBe(2)
    }),
  )

  it.effect("passes a crashed run's claim on once its instance ended, reusing saved stages", () =>
    Effect.gen(function* () {
      const test = world()
      const { version } = yield* paper(1)
      const crashing = workflow({ crash: `publish ${yield* keyFor(1)}` })

      test.instances.live.add("run-a")

      const fiber = yield* Effect.forkChild(
        annotating(test, annotate(version), { run: "run-a", steps: crashing }),
      )

      yield* crashing.crashed
      yield* Fiber.interrupt(fiber)

      const [held] = yield* annotating(test, annotate(version), { run: "run-b" })

      expect(held?.outcome).toEqual(Outcome.cases.Skipped.make({ reason: "Held" }))

      test.instances.live.delete("run-a")

      const taken = yield* annotating(test, annotate(version), { run: "run-c" })

      expect(done(taken)).toEqual(["Annotated"])
      // The crashed run's scope and labels served the run that took over.
      expect([test.provider.scopes(), test.provider.labels()]).toEqual([1, 1])
    }),
  )

  it.effect("stops a restarted instance whose claim another run took over, before spending", () =>
    Effect.gen(function* () {
      const test = world()
      const { version } = yield* paper(1)
      const annotation = yield* keyFor(1)
      const a = workflow({ crash: `scope ${annotation}` })
      const b = workflow({ crash: `scope ${annotation}` })

      const crash = (run: string, steps: ReturnType<typeof workflow>) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(annotating(test, annotate(version), { run, steps }))

          yield* steps.crashed
          yield* Fiber.interrupt(fiber)
        })

      // A stops before its scope call. B takes its claim over once A has
      // ended, and stops there too, while its instance still runs.
      yield* crash("run-a", a)
      test.instances.live.add("run-b")
      yield* crash("run-b", b)

      expect(yield* keyState(annotation)).toMatchObject({ state: "Running", run: "run-b" })

      // A restarted from the step that failed: its plan, claim and load replay.
      a.revive()

      const [stopped] = yield* annotating(test, annotate(version), { run: "run-a", steps: a })

      expect(stopped?.outcome).toEqual(Outcome.cases.Skipped.make({ reason: "Held" }))
      expect([test.provider.scopes(), test.provider.labels()]).toEqual([0, 0])
      expect(yield* keyState(annotation)).toMatchObject({ state: "Running", run: "run-b" })

      b.revive()

      const finished = yield* annotating(test, annotate(version), { run: "run-b", steps: b })

      expect(done(finished)).toEqual(["Annotated"])
      expect([test.provider.scopes(), test.provider.labels()]).toEqual([1, 1])
      expect(yield* keyState(annotation)).toMatchObject({ state: "Ready", run: "run-b" })
    }),
  )

  it.effect("claims no new key once the run's tokens reach the cap, or past its paper cap", () =>
    Effect.gen(function* () {
      const test = world()
      const [one, two] = yield* Effect.all([paper(1), paper(2)])

      const spent = yield* annotating(test, annotate(one.version, two.version), {
        limits: { tokens: 1, concurrent: 1 },
      })

      expect(done(spent)).toEqual(["Annotated", "NotStarted"])
      expect(yield* keyState(yield* keyFor(2))).toBeNull()

      const capped = yield* annotating(test, annotate(two.version, one.version), {
        run: "run-2",
        limits: { papers: 1 },
      })

      expect(done(capped)).toEqual(["Annotated", "NotStarted"])
      expect([test.provider.scopes(), test.provider.labels()]).toEqual([2, 2])
    }),
  )

  it.effect(
    "takes an annotation the publication command imported as ready, with no model call",
    () =>
      Effect.gen(function* () {
        const test = world()

        const { paper: id, version } = yield* publish({
          paper: bibliography({ id: PaperId.make("1".repeat(64)) }),
          passages: textOf(1),
          annotation: body(textOf(1)),
        }).pipe(Effect.provide(papersDb))

        const results = yield* annotating(test, annotate(version))

        expect(done(results)).toEqual(["Annotated"])
        expect([test.provider.scopes(), test.provider.labels()]).toEqual([0, 0])
        expect(yield* keyState(keyOf(results))).toMatchObject({ state: "Ready" })
        expect((yield* read(id)).annotation).toEqual(body(textOf(1)))
      }),
  )

  it.effect("keeps an annotation under older settings active until its replacement is ready", () =>
    Effect.gen(function* () {
      const test = world()

      const { paper: id, version } = yield* publish({
        paper: bibliography({ id: PaperId.make("1".repeat(64)) }),
        passages: textOf(1),
        annotation: body(textOf(1)),
      }).pipe(Effect.provide(papersDb))

      const settings = { model, rubric: "research-4" }

      test.provider.state.labels = "Down"
      yield* annotating(test, annotate(version), { settings })

      expect((yield* read(id)).annotation).toEqual(body(textOf(1)))

      test.provider.state.labels = "Ok"

      const result = yield* annotating(test, annotate(version), { run: "run-2", settings })

      expect(done(result)).toEqual(["Annotated"])
      expect((yield* read(id)).annotation?.labels.map(({ category }) => category)).toEqual([
        "Description",
        "Association",
      ])
    }),
  )

  it.effect("finds a restarted run's key stale after a settings change, and calls no model", () =>
    Effect.gen(function* () {
      const test = world()
      const { version } = yield* paper(1)
      const crashing = workflow({ crash: `load ${yield* keyFor(1)}` })

      test.instances.live.add("run-a")

      const fiber = yield* Effect.forkChild(
        annotating(test, annotate(version), { run: "run-a", steps: crashing }),
      )

      yield* crashing.crashed
      yield* Fiber.interrupt(fiber)

      // Restarted under new settings: its plan and claim replay.
      crashing.revive()

      const [stale] = yield* annotating(test, annotate(version), {
        run: "run-a",
        steps: crashing,
        settings: { model, rubric: "research-4" },
      })

      expect(stale?.outcome).toEqual(Outcome.cases.Skipped.make({ reason: "Stale" }))
      expect([test.provider.scopes(), test.provider.labels()]).toEqual([0, 0])
      expect(yield* keyState(yield* keyFor(1))).toMatchObject({ state: "Failed", attempts: 0 })
    }),
  )

  it.effect("retires an annotation under older settings and keeps a current one", () =>
    Effect.gen(function* () {
      const test = world()

      const older = yield* publish({
        paper: bibliography({ id: PaperId.make("1".repeat(64)) }),
        passages: textOf(1),
        annotation: body(textOf(1)),
      }).pipe(Effect.provide(papersDb))

      const current = yield* publish({
        paper: bibliography({ id: PaperId.make("2".repeat(64)) }),
        passages: textOf(2),
        annotation: body(textOf(2)),
      }).pipe(Effect.provide(papersDb))

      yield* annotating(test, Params.cases.Retire.make({ versions: [older.version] }), {
        settings: { model, rubric: "research-4" },
      })
      yield* annotating(test, Params.cases.Retire.make({ versions: [current.version] }), {
        run: "run-2",
      })

      expect((yield* read(older.paper)).annotation).toBeNull()
      expect((yield* read(current.paper)).annotation).toEqual(body(textOf(2)))
    }),
  )
})

// Publishes paper `n` with an annotation under the rubric research-3.
const imported = (n: number) =>
  publish({
    paper: bibliography({ id: PaperId.make(String(n).repeat(64)) }),
    passages: textOf(n),
    annotation: body(textOf(n)),
  }).pipe(Effect.provide(papersDb))

const versionsOf = (results: ReadonlyArray<Report>) => results.map(({ version }) => version)

const recordsOf = (run: string) =>
  Effect.map(records, (rows) => rows.filter((row) => row.run === run))

describe("a Demand run", () => {
  it.effect("annotates each version questions asked for once, and lists none of them again", () =>
    Effect.gen(function* () {
      const test = world()
      const [a, b, c] = yield* Effect.all([paper(1), paper(2), paper(3)])

      yield* ask(a.version, b.version, c.version)

      const first = yield* annotating(test, daily)

      expect(versionsOf(first).toSorted()).toEqual([a.version, b.version, c.version].toSorted())
      expect(done(first)).toEqual(["Annotated", "Annotated", "Annotated"])
      expect([test.provider.scopes(), test.provider.labels()]).toEqual([3, 3])

      yield* ask(a.version, b.version, c.version)

      expect(yield* annotating(test, daily, { run: "run-2" })).toEqual([])
      expect([test.provider.scopes(), test.provider.labels()]).toEqual([3, 3])
      expect(yield* recordsOf("run-2")).toEqual([])
    }),
  )

  it.effect(
    "lists versions with no annotation first, then those under older settings, most asked first",
    () =>
      Effect.gen(function* () {
        const test = world()

        const [none, more, older, fewer] = yield* Effect.all([
          paper(1),
          paper(2),
          imported(3),
          imported(4),
        ])

        yield* ask(none.version, more.version, more.version, more.version)
        yield* ask(older.version, older.version, older.version, older.version, older.version)
        yield* ask(fewer.version, fewer.version)

        const results = yield* annotating(test, daily, {
          settings: { model, rubric: "research-4" },
        })

        expect(versionsOf(results)).toEqual([
          more.version,
          none.version,
          older.version,
          fewer.version,
        ])
        expect(done(results)).toEqual(["Annotated", "Annotated", "Annotated", "Annotated"])
      }),
  )

  it.effect("leaves the versions past the paper cap NotStarted for the next run", () =>
    Effect.gen(function* () {
      const test = world()
      const [a, b, c] = yield* Effect.all([paper(1), paper(2), paper(3)])

      yield* ask(a.version, a.version, a.version, b.version, b.version, c.version)

      const capped = yield* annotating(test, daily, { limits: { papers: 2 } })

      expect(versionsOf(capped)).toEqual([a.version, b.version, c.version])
      expect(done(capped)).toEqual(["Annotated", "Annotated", "NotStarted"])
      expect([test.provider.scopes(), test.provider.labels()]).toEqual([2, 2])

      const [waiting] = yield* recordsOf("run-1").pipe(
        Effect.map((rows) => rows.filter((row) => row.version === c.version)),
      )

      expect(waiting).toMatchObject({
        outcome: JSON.stringify(Outcome.cases.NotStarted.make({})),
        requests: 0,
      })
      expect(yield* keyState(yield* keyFor(3))).toBeNull()

      const next = yield* annotating(test, daily, { run: "run-2", limits: { papers: 2 } })

      expect(versionsOf(next)).toEqual([c.version])
      expect(done(next)).toEqual(["Annotated"])
    }),
  )

  it.effect(
    "skips Ready, Abandoned, current and withdrawn versions, and takes a Failed key again",
    () =>
      Effect.gen(function* () {
        const test = world()

        const [ready, abandoned, failed, current, open] = yield* Effect.all([
          paper(1),
          paper(2),
          paper(3),
          imported(4),
          paper(5),
        ])

        const withdrawn = "f".repeat(64)

        yield* annotating(test, annotate(ready.version), { run: "run-ready" })

        test.provider.state.scope = "Malformed"
        yield* annotating(test, annotate(abandoned.version), {
          run: "run-abandoned",
          limits: { attempts: 1 },
        })
        yield* annotating(test, annotate(failed.version), { run: "run-failed" })
        test.provider.state.scope = "Ok"

        expect(yield* keyState(yield* keyFor(2))).toMatchObject({ state: "Abandoned" })
        expect(yield* keyState(yield* keyFor(3))).toMatchObject({ state: "Failed", attempts: 1 })

        yield* ask(ready.version, abandoned.version, failed.version, current.version, withdrawn)
        yield* ask(open.version)
        yield* ask(open.version)

        const [scopes, labels] = [test.provider.scopes(), test.provider.labels()]
        const results = yield* annotating(test, daily)

        expect(versionsOf(results)).toEqual([open.version, failed.version])
        expect(done(results)).toEqual(["Annotated", "Annotated"])
        expect([test.provider.scopes() - scopes, test.provider.labels() - labels]).toEqual([2, 2])
      }),
  )

  it.effect(
    "lists no Ready key after Workflow history retention removed the run that made it",
    () =>
      Effect.gen(function* () {
        const test = world()
        const { version } = yield* paper(1)

        yield* ask(version)
        yield* annotating(test, daily, { run: "run-1" })

        // Weeks later the Workflow API no longer knows run-1, and questions
        // still ask for the paper.
        yield* TestClock.adjust(Duration.days(20))
        yield* ask(version)

        expect(yield* annotating(test, daily, { run: "run-2" })).toEqual([])
        expect([test.provider.scopes(), test.provider.labels()]).toEqual([1, 1])
      }),
  )

  it.effect("lists only versions asked for in the last 30 days", () =>
    Effect.gen(function* () {
      const test = world()
      const [old, recent] = yield* Effect.all([paper(1), paper(2)])

      yield* ask(old.version)
      yield* TestClock.adjust(Duration.days(31))
      yield* ask(recent.version)

      expect(versionsOf(yield* annotating(test, daily))).toEqual([recent.version])
    }),
  )

  it.effect("reads demand once, and lists the same versions when Workflows replays the run", () =>
    Effect.gen(function* () {
      const test = world()
      const [first, later] = yield* Effect.all([paper(1), paper(2)])
      const crashing = workflow({ crash: `scope ${yield* keyFor(1)}` })

      test.instances.live.add("run-1")
      yield* ask(first.version)

      const fiber = yield* Effect.forkChild(annotating(test, daily, { steps: crashing }))

      yield* crashing.crashed
      yield* Fiber.interrupt(fiber)

      // Asked for after the selection: the restarted instance replays it.
      yield* ask(later.version)
      crashing.revive()

      const results = yield* annotating(test, daily, { steps: crashing })

      expect(versionsOf(results)).toEqual([first.version])
      expect(done(results)).toEqual(["Annotated"])
      expect(test.demand.reads()).toBe(1)
    }),
  )

  it.effect("calls no model and writes nothing when no question asked for a paper", () =>
    Effect.gen(function* () {
      const test = world()

      expect(yield* annotating(test, daily)).toEqual([])
      expect([test.provider.scopes(), test.provider.labels()]).toEqual([0, 0])

      const sql = yield* SqlClient.SqlClient.pipe(Effect.provide(papersDb))

      const written = yield* sql`
        SELECT name FROM sqlite_master WHERE name LIKE 'annotation%'
      `.pipe(Effect.provide(papersDb))

      expect(written).toEqual([])
    }),
  )

  it.effect("annotates each key once when a run started by hand overlaps the daily run", () =>
    Effect.gen(function* () {
      const test = world()
      const [a, b, c] = yield* Effect.all([paper(1), paper(2), paper(3)])

      yield* ask(a.version, b.version, c.version)
      test.instances.live.add("run-hand")
      test.instances.live.add("run-daily")

      yield* Effect.all(
        [
          annotating(test, annotate(a.version, b.version), { run: "run-hand" }),
          annotating(test, daily, { run: "run-daily" }),
        ],
        { concurrency: "unbounded" },
      )

      expect([test.provider.scopes(), test.provider.labels()]).toEqual([3, 3])

      for (const n of [1, 2, 3])
        expect(yield* keyState(yield* keyFor(n))).toMatchObject({ state: "Ready" })
    }),
  )
})
