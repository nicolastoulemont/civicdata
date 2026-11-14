// The ambient declaration must reach every program that compiles this file,
// including apps/web; a .d.ts cannot be imported.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="../cloudflare.d.ts" />

import { D1Client } from "@effect/sql-d1"
import {
  Array as Arr,
  Clock,
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Predicate,
  Redacted,
  Ref,
  Result,
  Schema,
} from "effect"
import { FetchHttpClient } from "effect/http"
import { SqlClient, SqlSchema } from "effect/sql"

import { type StepFailed } from "../platform/Step.schemas.ts"
import { Step } from "../platform/Step.ts"
import { fingerprint } from "../utils/fingerprint.ts"
import { Outcome, Params, Report, Stage, VersionId } from "./Annotate.schemas.ts"
import type { AnnotateBinding } from "./Annotate.types.ts"
import { Classification, Scope } from "./annotation.schemas.ts"
import { Settings } from "./annotation.ts"
import { AnnotationInvalid, ProviderFailed, Usage } from "./Annotator.schemas.ts"
import { Annotator } from "./Annotator.ts"
import { Digest, Passage } from "./archive.schemas.ts"
import { Demand } from "./Demand.ts"
import { Body, Text as Passages, Version } from "./store.schemas.ts"
import { annotationKey, tables as store } from "./store.ts"
import { complete } from "./utils/complete.ts"
import { excerptsComplete } from "./utils/excerptsComplete.ts"
import { grounded } from "./utils/grounded.ts"
import { objectsOf } from "./utils/objectsOf.ts"

// The Annotate Workflow's work: claims each annotation key of a list of paper
// versions, saves its scope and labels, and publishes its annotation as the
// versions' active one. docs/papers.md#annotation describes the states and
// the caps.

// How much one run may do. Each paper costs one scope and one classification
// request; `tokens` caps what the provider reported for a whole run.
export const Limits = Context.Reference<{
  // Keys a run takes from its list; the rest are NotStarted.
  readonly papers: number
  // Keys in progress at once.
  readonly concurrent: number
  // Tokens a run may spend before it claims no new key.
  readonly tokens: number
  // Failed runs before a key is Abandoned.
  readonly attempts: number
}>("@repo/server/research/Limits", {
  defaultValue: () => ({ papers: 20, concurrent: 4, tokens: 3_000_000, attempts: 3 }),
})

// How far back a Demand run reads what questions asked for.
const recent = { days: 30 }

type Stage = typeof Stage.Type

// An annotation key's state. Only this Workflow writes it.
// - Running: `run` claimed the key.
// - Ready: `run` published its annotation, or found it already published
//   by the publication command (docs/papers.md#publication).
// - Failed: a run gave up, or released the key as stale or withdrawn; a run
//   may claim it while attempts are below the limit.
// - Abandoned: the limit's worth of runs failed; only a run started with
//   `retry` claims it again.
const State = Schema.TaggedUnion({
  Running: { run: Schema.String },
  Ready: { run: Schema.String },
  Failed: { attempts: Schema.Int, reason: Schema.String },
  Abandoned: { attempts: Schema.Int, reason: Schema.String },
})

// The tables only this Workflow writes, beside the store's.
// - annotation_key: each key's State.
// - annotation_stage: a key's saved scope and labels, which any later run
//   for the key reuses instead of asking the model again.
// - annotation_run: one row per run and listed version: its Outcome, the
//   key's attempts after the run, its timing and its model usage.
const tables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* store

  yield* sql`CREATE TABLE IF NOT EXISTS annotation_key (
    key TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('Running', 'Ready', 'Failed', 'Abandoned')),
    run TEXT,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    reason TEXT,
    CHECK ((state IN ('Running', 'Ready')) = (run IS NOT NULL)),
    CHECK (state IN ('Running', 'Ready') OR reason IS NOT NULL)
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS annotation_stage (
    key TEXT NOT NULL REFERENCES annotation_key (key),
    stage TEXT NOT NULL CHECK (stage IN ('Scope', 'Labels')),
    body TEXT NOT NULL CHECK (json_valid(body)),
    created_at TEXT NOT NULL,
    PRIMARY KEY (key, stage)
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS annotation_run (
    run TEXT NOT NULL,
    version TEXT NOT NULL,
    key TEXT,
    outcome TEXT NOT NULL CHECK (json_valid(outcome)),
    attempts INTEGER,
    requests INTEGER NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    started_at TEXT,
    ended_at TEXT NOT NULL,
    PRIMARY KEY (run, version)
  )`
})

// What the Workflow asks of the Workflow API: whether an instance has ended.
// An instance the API no longer knows has ended.
export class Instances extends Context.Service<
  Instances,
  { readonly ended: (run: string) => Effect.Effect<boolean, InstancesUnavailable> }
>()("@repo/server/research/Instances") {
  static readonly make = (workflow: AnnotateBinding) =>
    Layer.succeed(
      Instances,
      Instances.of({
        ended: (run) =>
          Effect.tryPromise({
            try: async () => {
              const { status } = await (await workflow.get(run)).status()

              return status === "complete" || status === "errored" || status === "terminated"
            },
            catch: (cause) => new InstancesUnavailable({ problem: String(cause) }),
          }).pipe(
            Effect.catchTag("InstancesUnavailable", (error) =>
              /not.?found/i.test(error.problem) ? Effect.succeed(true) : Effect.fail(error),
            ),
          ),
      }),
    )
}

// The Workflow API did not answer.
class InstancesUnavailable extends Schema.TaggedError<
  InstancesUnavailable,
  { readonly brand: unique symbol }
>()("InstancesUnavailable", { problem: Schema.String }) {}

// What the Workflow uses of the PAPERS bucket.
interface TextBucket {
  readonly get: (key: string) => Promise<{ readonly text: () => Promise<string> } | null>
}

// A claim step's answer.
const Claim = Schema.TaggedUnion({
  Claimed: { at: Schema.String },
  Ready: {},
  Held: {},
  Abandoned: {},
  NotStarted: {},
})

// A stage step's answer. A provider or store failure throws instead, so the
// step retries.
const Done = Schema.TaggedUnion({
  Done: { usage: Usage },
  Lost: {},
  Stale: {},
  Withdrawn: {},
  Invalid: { problem: Schema.String },
  Unavailable: { problem: Schema.String },
})

type Done = typeof Done.Type

// The listed versions grouped by key, in list order; a version the store no
// longer holds has none.
const Plan = Schema.Array(
  Schema.Struct({ key: Schema.NullOr(Digest), versions: Schema.NonEmptyArray(VersionId) }),
)

type Job = (typeof Plan.Type)[number]

// A job whose versions the store still holds.
interface Keyed extends Job {
  readonly key: Job["versions"][number]
}

const none: Usage = { requests: 0, input: null, output: null }

const add = (left: number | null, right: number | null) =>
  left === null ? right : right === null ? left : left + right

const sum = (left: Usage, right: Usage): Usage => ({
  requests: left.requests + right.requests,
  input: add(left.input, right.input),
  output: add(left.output, right.output),
})

const VersionRow = Schema.Struct({
  id: VersionId,
  text: Version.fields.text,
  extraction: Version.fields.extraction,
})

type VersionRow = typeof VersionRow.Type

// A stage's input: the passages of a listed version with the key's text.
const Text = Schema.TaggedStruct("Text", {
  passages: Schema.Array(Passage),
  version: VersionRow,
})

// Thrown out of a step so that Workflows retries it and keeps its message,
// which tells a provider failure from a store one after the last retry.
const thrown = (error: ProviderFailed | { readonly message: string }) =>
  new Error(
    error instanceof ProviderFailed ? `Provider: ${error.problem}` : `Store: ${error.message}`,
  )

const failedStep = (stage: Stage, { cause }: StepFailed): Outcome => {
  const message = cause instanceof Error ? cause.message : String(cause)

  return Outcome.cases.Failed.make({
    stage,
    reason: message.startsWith("Provider: ") ? "Provider" : "Store",
    problem: message.slice(0, 500),
  })
}

interface Interface {
  // Runs one instance's command. `run` is the Workflow instance's id.
  readonly run: (
    params: Params,
    run: string,
  ) => Effect.Effect<ReadonlyArray<Report>, StepFailed, Step>
}

export class Annotate extends Context.Service<Annotate, Interface>()(
  "@repo/server/research/Annotate",
) {
  static readonly make = (bucket: TextBucket) =>
    Layer.effect(
      Annotate,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const d1 = yield* D1Client.D1Client
        const annotator = yield* Annotator
        const instances = yield* Instances
        const demand = yield* Demand

        const versionsOf = SqlSchema.findAll({
          Request: Schema.Array(VersionId),
          Result: VersionRow,
          execute: (ids) => sql`
            SELECT id, text, extraction FROM version
            WHERE id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))
          `,
        })

        // Listed versions that are their paper's active one, with the
        // annotation they point to.
        const candidates = SqlSchema.findAll({
          Request: Schema.Array(VersionId),
          Result: Schema.Struct({ ...VersionRow.fields, annotation: Schema.NullOr(Digest) }),
          execute: (ids) => sql`
            SELECT version.id, version.text, version.extraction, version.annotation
            FROM version JOIN paper ON paper.active = version.id
            WHERE version.id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))
          `,
        })

        const statesOf = SqlSchema.findAll({
          Request: Schema.Array(Digest),
          Result: Schema.Struct({
            key: Digest,
            state: Schema.Literals(["Running", "Ready", "Failed", "Abandoned"]),
          }),
          execute: (keys) => sql`
            SELECT key, state FROM annotation_key
            WHERE key IN (SELECT value FROM json_each(${JSON.stringify(keys)}))
          `,
        })

        const stateOf = SqlSchema.findOneOption({
          Request: Digest,
          Result: Schema.Struct({ state: Schema.fromJsonString(State) }),
          execute: (key) => sql`
            SELECT json_object('_tag', state, 'run', run, 'attempts', attempts, 'reason', reason)
              AS state
            FROM annotation_key WHERE key = ${key}
          `,
        })

        const savedOf = SqlSchema.findOneOption({
          Request: Schema.Struct({ key: Digest, stage: Schema.Literals(["Scope", "Labels"]) }),
          Result: Schema.Struct({ body: Schema.String }),
          execute: ({ key, stage }) => sql`
            SELECT body FROM annotation_stage WHERE key = ${key} AND stage = ${stage}
          `,
        })

        // The key's annotation, when one is published: by an earlier run, or
        // imported by the publication command, which writes no key state.
        const published = SqlSchema.findOneOption({
          Request: Digest,
          Result: Schema.Struct({ key: Digest }),
          execute: (key) => sql`SELECT key FROM annotation WHERE key = ${key}`,
        })

        const keyOf = Effect.fnUntraced(function* (version: VersionRow) {
          const { model, rubric } = yield* Settings

          return yield* annotationKey({
            text: version.text,
            extraction: version.extraction,
            model,
            rubric,
          })
        })

        // Whether `run` holds `key`: Running under it, or Ready because it
        // published. Read inside every step that calls the model or writes,
        // never remembered: a replayed step proves nothing about who holds
        // the key now.
        const holds = Effect.fnUntraced(function* (key: string, run: string) {
          return Option.exists(
            yield* stateOf(key),
            ({ state }) =>
              (State.guards.Running(state) || State.guards.Ready(state)) && state.run === run,
          )
        })

        // The text a stage reads: a listed version that still has the key's
        // text under the current settings, its passages from PAPERS.
        const input = Effect.fnUntraced(function* (key: string, versions: ReadonlyArray<string>) {
          const rows = yield* versionsOf(versions)

          if (!Arr.isArrayNonEmpty(rows)) return Done.cases.Withdrawn.make({})

          const current = yield* Effect.filter(rows, (row) =>
            Effect.map(keyOf(row), (computed) => computed === key),
          )

          const version = current[0]

          if (version === undefined) return Done.cases.Stale.make({})

          const object = yield* Effect.tryPromise(() => bucket.get(objectsOf(version.id).text))

          if (object === null) return Done.cases.Unavailable.make({ problem: "No text object" })

          const bytes = yield* Effect.tryPromise(() => object.text())

          if ((yield* fingerprint(bytes)) !== version.text)
            return Done.cases.Unavailable.make({ problem: "Text object hash mismatch" })

          const passages = yield* Schema.decodeEffect(Passages)(bytes).pipe(Effect.option)

          if (Option.isNone(passages))
            return Done.cases.Unavailable.make({ problem: "Text object does not decode" })

          return Text.make({ passages: passages.value, version })
        })

        // Saves a stage's output while `run` holds the key, and answers
        // whether it did.
        const save = Effect.fnUntraced(function* (options: {
          readonly key: string
          readonly run: string
          readonly stage: "Scope" | "Labels"
          readonly body: string
        }) {
          const now = new Date(yield* Clock.currentTimeMillis).toISOString()

          const rows = yield* sql`
            INSERT INTO annotation_stage (key, stage, body, created_at)
            SELECT ${options.key}, ${options.stage}, ${options.body}, ${now}
            WHERE EXISTS (
              SELECT 1 FROM annotation_key
              WHERE key = ${options.key} AND state = 'Running' AND run = ${options.run}
            )
            ON CONFLICT (key, stage) DO UPDATE SET body = excluded.body, created_at = excluded.created_at
            RETURNING key
          `

          return rows.length > 0
        })

        // Points every version with the key's text at its annotation, if
        // the key is Ready and the annotation is under the current
        // settings. A version under another key's annotation keeps it
        // until then.
        const point = (key: string, { model, rubric }: typeof Settings.Service) => sql`
          UPDATE version SET annotation = ${key}
          WHERE (text, extraction) = (
            SELECT text, extraction FROM annotation
            WHERE key = ${key} AND model = ${model} AND rubric = ${rubric}
          )
          AND annotation IS NOT ${key}
          AND EXISTS (SELECT 1 FROM annotation_key WHERE key = ${key} AND state = 'Ready')
        `

        const claim = Effect.fnUntraced(function* (options: {
          readonly key: string
          readonly run: string
          readonly retry: boolean
          readonly spent: number
        }) {
          const { key, run, retry } = options
          const limits = yield* Limits
          const settings = yield* Settings

          if (options.spent >= limits.tokens) return Claim.cases.NotStarted.make({})

          const current = yield* stateOf(key)
          let ended: string | null = null

          // An imported annotation is ready under this key's settings: record
          // it so, and point its versions at it, with no model call.
          if (Option.isNone(current) && Option.isSome(yield* published(key))) {
            yield* sql`
              INSERT INTO annotation_key (key, state, run, attempts, reason)
              VALUES (${key}, 'Ready', ${run}, 0, NULL)
              ON CONFLICT (key) DO NOTHING
            `
            yield* point(key, settings)

            return Claim.cases.Ready.make({})
          }

          if (Option.isSome(current)) {
            const { state } = current.value

            const next = yield* State.match(state, {
              Running: (held) =>
                held.run === run
                  ? Effect.succeed(null)
                  : Effect.map(instances.ended(held.run), (over) => {
                      if (over) ended = held.run

                      return over ? null : Claim.cases.Held.make({})
                    }),
              Ready: () => Effect.as(point(key, settings), Claim.cases.Ready.make({})),
              Failed: () => Effect.succeed(null),
              Abandoned: () => Effect.succeed(retry ? null : Claim.cases.Abandoned.make({})),
            })

            if (next !== null) return next
          }

          // One statement: a new key, a Failed one under the limit, one this
          // run already holds (a retried claim whose write landed), one held
          // by an instance that has ended, or an Abandoned one on retry.
          const claimed = yield* sql`
            INSERT INTO annotation_key (key, state, run, attempts, reason)
            VALUES (${key}, 'Running', ${run}, 0, NULL)
            ON CONFLICT (key) DO UPDATE SET
              state = 'Running',
              run = excluded.run,
              attempts = CASE WHEN annotation_key.state = 'Abandoned' THEN 0
                ELSE annotation_key.attempts END
            WHERE (annotation_key.state = 'Failed' AND annotation_key.attempts < ${limits.attempts})
              OR (annotation_key.state = 'Running' AND annotation_key.run IN (${run}, ${ended}))
              OR (annotation_key.state = 'Abandoned' AND ${retry ? 1 : 0} = 1)
            RETURNING key
          `

          if (claimed.length === 0) return Claim.cases.Held.make({})

          return Claim.cases.Claimed.make({
            at: new Date(yield* Clock.currentTimeMillis).toISOString(),
          })
        })

        const load = Effect.fnUntraced(function* (job: Keyed, run: string) {
          if (!(yield* holds(job.key, run))) return Done.cases.Lost.make({})

          const text = yield* input(job.key, job.versions)

          return Predicate.isTagged(text, "Text") ? Done.cases.Done.make({ usage: none }) : text
        })

        // Where a model stage starts: Lost once another run holds the key,
        // Done when the key's output for the stage is saved, else the text.
        const begin = Effect.fnUntraced(function* (options: {
          readonly job: Keyed
          readonly run: string
          readonly stage: "Scope" | "Labels"
        }) {
          const { job, run, stage } = options

          if (!(yield* holds(job.key, run))) return Done.cases.Lost.make({})

          if (Option.isSome(yield* savedOf({ key: job.key, stage })))
            return Done.cases.Done.make({ usage: none })

          return yield* input(job.key, job.versions)
        })

        const scope = Effect.fnUntraced(function* (job: Keyed, run: string) {
          const text = yield* begin({ job, run, stage: "Scope" })

          if (!Predicate.isTagged(text, "Text")) return text

          const scoped = yield* annotator.scope(text.passages).pipe(Effect.result)

          if (Result.isFailure(scoped)) {
            if (scoped.failure instanceof AnnotationInvalid)
              return Done.cases.Invalid.make({ problem: scoped.failure.problem })

            return yield* scoped.failure
          }

          const saved = yield* save({
            key: job.key,
            run,
            stage: "Scope",
            body: JSON.stringify(Scope.make(scoped.success.scope)),
          })

          return saved
            ? Done.cases.Done.make({ usage: scoped.success.usage })
            : Done.cases.Lost.make({})
        })

        const labels = Effect.fnUntraced(function* (job: Keyed, run: string) {
          const text = yield* begin({ job, run, stage: "Labels" })

          if (!Predicate.isTagged(text, "Text")) return text

          const saved = yield* savedOf({ key: job.key, stage: "Scope" })

          if (Option.isNone(saved)) return Done.cases.Invalid.make({ problem: "No saved scope" })

          const scoped = yield* Schema.decodeEffect(Schema.fromJsonString(Scope))(saved.value.body)

          const classified = yield* annotator
            .labels(text.passages, { excerpts: scoped.excerpts })
            .pipe(Effect.result)

          if (Result.isFailure(classified)) {
            if (classified.failure instanceof AnnotationInvalid)
              return Done.cases.Invalid.make({ problem: classified.failure.problem })

            return yield* classified.failure
          }

          const { usage, ...result } = classified.success

          if (!excerptsComplete(result, scoped))
            return Done.cases.Invalid.make({ problem: "Excerpt labels do not match the scope" })

          const written = yield* save({
            key: job.key,
            run,
            stage: "Labels",
            body: JSON.stringify(Classification.make(result)),
          })

          return written ? Done.cases.Done.make({ usage }) : Done.cases.Lost.make({})
        })

        // Checks the saved stages against the text once more, then in one
        // D1 batch: adds the annotation, marks the key Ready, and points
        // the versions at it. Each statement holds only while `run` holds
        // the key, so a run that lost it writes nothing.
        const publish = Effect.fnUntraced(function* (job: Keyed, run: string) {
          const text = yield* input(job.key, job.versions)

          if (!Predicate.isTagged(text, "Text")) return text

          const [scoped, classified] = yield* Effect.all([
            savedOf({ key: job.key, stage: "Scope" }),
            savedOf({ key: job.key, stage: "Labels" }),
          ])

          if (Option.isNone(scoped) || Option.isNone(classified))
            return Done.cases.Invalid.make({ problem: "No saved scope or labels" })

          const body = Body.make({
            scope: yield* Schema.decodeEffect(Schema.fromJsonString(Scope))(scoped.value.body),
            ...(yield* Schema.decodeEffect(Schema.fromJsonString(Classification))(
              classified.value.body,
            )),
          })

          if (
            !grounded(body.scope, text.passages) ||
            !complete(body.labels, text.passages) ||
            !excerptsComplete(body, body.scope)
          )
            return Done.cases.Invalid.make({ problem: "Saved stages do not match the text" })

          const settings = yield* Settings
          const { model, rubric } = settings
          const now = new Date(yield* Clock.currentTimeMillis).toISOString()

          const holding = sql`
            SELECT 1 FROM annotation_key
            WHERE key = ${job.key} AND run = ${run} AND state IN ('Running', 'Ready')
          `

          const [, ready] = yield* d1.batch([
            sql`
              INSERT INTO annotation (key, text, extraction, model, rubric, body, created_at)
              SELECT ${job.key}, ${text.version.text}, ${text.version.extraction}, ${model},
                ${rubric}, ${JSON.stringify(body)}, ${now}
              WHERE EXISTS (${holding})
              ON CONFLICT (key) DO NOTHING
            `,
            sql`
              UPDATE annotation_key SET state = 'Ready', reason = NULL
              WHERE key = ${job.key} AND run = ${run} AND state IN ('Running', 'Ready')
              RETURNING key
            `,
            point(job.key, settings),
          ])

          return ready !== undefined && ready.length > 0
            ? Done.cases.Done.make({ usage: none })
            : Done.cases.Lost.make({})
        })

        // Writes what a run did with one key: gives the key back or counts
        // the attempt while `run` holds it, then one record per version.
        const finish = Effect.fnUntraced(function* (options: {
          readonly job: Job
          readonly run: string
          readonly outcome: Outcome
          readonly usage: Usage
          readonly started: string | null
        }) {
          const { job, run, outcome } = options
          const limits = yield* Limits
          const now = new Date(yield* Clock.currentTimeMillis).toISOString()

          const release = (reason: string) => sql`
            UPDATE annotation_key SET state = 'Failed', run = NULL, reason = ${reason}
            WHERE key = ${job.key} AND state = 'Running' AND run = ${run}
          `

          yield* Outcome.match(outcome, {
            Annotated: () => Effect.void,
            NotStarted: () => Effect.void,
            Skipped: ({ reason }) =>
              reason === "Stale" || reason === "Withdrawn" ? release(reason) : Effect.void,
            Failed: ({ stage, reason, problem }) =>
              stage === "Claim"
                ? Effect.void
                : sql`
                    UPDATE annotation_key SET
                      state = CASE WHEN attempts + 1 >= ${limits.attempts} THEN 'Abandoned'
                        ELSE 'Failed' END,
                      run = NULL,
                      attempts = attempts + 1,
                      reason = ${`${reason} at ${stage}: ${problem}`}
                    WHERE key = ${job.key} AND state = 'Running' AND run = ${run}
                  `,
          })

          yield* Effect.forEach(
            job.versions,
            (version) => sql`
              INSERT INTO annotation_run (run, version, key, outcome, attempts, requests,
                input_tokens, output_tokens, started_at, ended_at)
              VALUES (${run}, ${version}, ${job.key}, ${JSON.stringify(outcome)},
                (SELECT attempts FROM annotation_key WHERE key = ${job.key}),
                ${options.usage.requests}, ${options.usage.input}, ${options.usage.output},
                ${options.started}, ${now})
              ON CONFLICT (run, version) DO UPDATE SET
                outcome = excluded.outcome, attempts = excluded.attempts,
                requests = excluded.requests, input_tokens = excluded.input_tokens,
                output_tokens = excluded.output_tokens, ended_at = excluded.ended_at
            `,
            { discard: true },
          )
        })

        // The versions a Demand run lists: asked for in the last 30 days,
        // with text, and whose current key is new or Failed. Versions with
        // no active annotation come first, then those whose active one is
        // under older settings, each group most asked first. Reads DB once,
        // then PAPERS_DB; with no demand it touches no store.
        const select = Effect.fnUntraced(function* () {
          const asked = yield* demand.since(DateTime.subtract(yield* DateTime.now, recent))

          if (asked.length === 0) return []

          yield* tables.pipe(Effect.provideService(SqlClient.SqlClient, sql))

          const rows = yield* Effect.forEach(
            yield* candidates(asked.map(({ version }) => version)),
            (row) => Effect.map(keyOf(row), (key) => ({ ...row, key })),
          )

          const states = new Map(
            (yield* statesOf(rows.map(({ key }) => key))).map(({ key, state }) => [key, state]),
          )

          const byId = new Map(rows.map((row) => [row.id, row]))

          // A key no run has claimed, or one a run gave back under the
          // attempt limit. A Ready, Running or Abandoned key waits.
          const open = ({ key, annotation }: (typeof rows)[number]) => {
            const state = states.get(key)

            return annotation !== key && (state === undefined || state === "Failed")
          }

          // In demand's order: most asked, then by version id.
          const eligible = asked.flatMap(({ version }) => {
            const row = byId.get(version)

            return row !== undefined && open(row) ? [row] : []
          })

          return [
            ...eligible.filter(({ annotation }) => annotation === null),
            ...eligible.filter(({ annotation }) => annotation !== null),
          ].map(({ id }) => id)
        })

        const annotate = Effect.fn("Annotate.annotate")(function* (
          params: typeof Params.cases.Annotate.Type,
          run: string,
        ) {
          const limits = yield* Limits
          const spent = yield* Ref.make(0)

          const plan = yield* kept(
            Plan,
            "plan",
            Effect.gen(function* () {
              yield* tables.pipe(Effect.provideService(SqlClient.SqlClient, sql))

              const listed = Arr.dedupe(params.versions)
              const rows = new Map((yield* versionsOf(listed)).map((row) => [row.id, row]))
              const jobs = new Map<string | null, Array<string>>()

              for (const version of listed) {
                const row = rows.get(version)
                const key = row === undefined ? null : yield* keyOf(row)

                jobs.set(key, [...(jobs.get(key) ?? []), version])
              }

              return [...jobs].flatMap(([key, versions]) =>
                Arr.isArrayNonEmpty(versions) ? [{ key, versions }] : [],
              )
            }),
          )

          const taken = new Set(
            plan.flatMap(({ key }) => (key === null ? [] : [key])).slice(0, limits.papers),
          )

          const stage = (name: Stage, job: Keyed, body: Effect.Effect<Done, unknown>) =>
            kept(
              Done,
              `${name.toLowerCase()} ${job.key}`,
              body.pipe(
                Effect.mapError((error) =>
                  error instanceof ProviderFailed
                    ? thrown(error)
                    : thrown({ message: error instanceof Error ? error.message : String(error) }),
                ),
              ),
            ).pipe(
              Effect.tap((done) =>
                Done.guards.Done(done)
                  ? Ref.update(
                      spent,
                      (total) => total + (done.usage.input ?? 0) + (done.usage.output ?? 0),
                    )
                  : Effect.void,
              ),
              Effect.result,
            )

          // Runs the stages in order until one does not finish.
          const work = Effect.fnUntraced(function* (job: Keyed) {
            let usage = none

            for (const [name, body] of [
              ["Load", load(job, run)],
              ["Scope", scope(job, run)],
              ["Labels", labels(job, run)],
              ["Publish", publish(job, run)],
            ] as const) {
              const result = yield* stage(name, job, body)

              if (Result.isFailure(result))
                return { outcome: failedStep(name, result.failure), usage }

              const done = result.success

              if (Done.guards.Done(done)) {
                usage = sum(usage, done.usage)
                continue
              }

              const outcome: Outcome = Done.match(done, {
                Done: () => Outcome.cases.Annotated.make({ key: job.key }),
                Lost: () => Outcome.cases.Skipped.make({ reason: "Held" }),
                Stale: () => Outcome.cases.Skipped.make({ reason: "Stale" }),
                Withdrawn: () => Outcome.cases.Skipped.make({ reason: "Withdrawn" }),
                Invalid: ({ problem }) =>
                  Outcome.cases.Failed.make({ stage: name, reason: "Invalid", problem }),
                Unavailable: ({ problem }) =>
                  Outcome.cases.Failed.make({ stage: name, reason: "Unavailable", problem }),
              })

              return { outcome, usage }
            }

            return { outcome: Outcome.cases.Annotated.make({ key: job.key }), usage }
          })

          const one = Effect.fnUntraced(function* (job: Job) {
            let started: string | null = null

            const { outcome, usage } = yield* Effect.gen(function* () {
              const { key, versions } = job

              if (key === null)
                return { outcome: Outcome.cases.Skipped.make({ reason: "Withdrawn" }), usage: none }

              const keyedJob: Keyed = { key, versions }

              if (!taken.has(key))
                return { outcome: Outcome.cases.NotStarted.make({}), usage: none }

              const claimed = yield* kept(
                Claim,
                `claim ${key}`,
                Effect.flatMap(Ref.get(spent), (total) =>
                  claim({ key, run, retry: params.retry === true, spent: total }),
                ).pipe(Effect.mapError((error) => thrown({ message: String(error) }))),
              ).pipe(Effect.result)

              if (Result.isFailure(claimed))
                return { outcome: failedStep("Claim", claimed.failure), usage: none }

              return yield* Claim.match(claimed.success, {
                Claimed: ({ at }) => {
                  started = at

                  return work(keyedJob)
                },
                Ready: () =>
                  Effect.succeed({
                    outcome: Outcome.cases.Annotated.make({ key: keyedJob.key }),
                    usage: none,
                  }),
                Held: () =>
                  Effect.succeed({
                    outcome: Outcome.cases.Skipped.make({ reason: "Held" }),
                    usage: none,
                  }),
                Abandoned: () =>
                  Effect.succeed({
                    outcome: Outcome.cases.Skipped.make({ reason: "Abandoned" }),
                    usage: none,
                  }),
                NotStarted: () =>
                  Effect.succeed({ outcome: Outcome.cases.NotStarted.make({}), usage: none }),
              })
            })

            yield* (yield* Step).run(
              `finish ${job.versions[0]}`,
              finish({ job, run, outcome, usage, started }).pipe(
                Effect.mapError((error) => thrown({ message: String(error) })),
              ),
            )

            return job.versions.map((version) => Report.make({ version, outcome }))
          })

          const results = yield* Effect.forEach(plan, one, { concurrency: limits.concurrent })

          return results.flat()
        })

        // Annotates what `select` lists. The selection is a step, so a
        // replayed run lists the same versions and reads demand once.
        const demanded = Effect.fn("Annotate.demand")(function* (run: string) {
          const versions = yield* kept(
            Schema.Array(VersionId),
            "select",
            select().pipe(Effect.mapError((error) => thrown({ message: String(error) }))),
          )

          const listed = [...versions]

          if (!Arr.isArrayNonEmpty(listed)) return []

          return yield* annotate(Params.cases.Annotate.make({ versions: listed }), run)
        })

        // Clears each listed version's active annotation when it is under
        // settings other than the current ones.
        const retire = Effect.fn("Annotate.retire")(function* (
          params: typeof Params.cases.Retire.Type,
        ) {
          const { model, rubric } = yield* Settings

          yield* (yield* Step).run(
            "retire",
            Effect.gen(function* () {
              yield* tables.pipe(Effect.provideService(SqlClient.SqlClient, sql))

              yield* sql`
                UPDATE version SET annotation = NULL
                WHERE id IN (SELECT value FROM json_each(${JSON.stringify(params.versions)}))
                AND annotation IN (
                  SELECT key FROM annotation WHERE model <> ${model} OR rubric <> ${rubric}
                )
              `
            }).pipe(Effect.mapError((error) => thrown({ message: String(error) }))),
          )

          return []
        })

        const run = (params: Params, instance: string) =>
          Params.match(params, {
            Annotate: (command) => annotate(command, instance),
            Demand: () => demanded(instance),
            Retire: (command) => retire(command),
          })

        return Annotate.of({ run })
      }),
    )

  // Inside Workers: PAPERS_DB, PAPERS, OpenAI, the ANNOTATE binding and the
  // demand in DB.
  // A Worker without them binds no Annotate Workflow, so this never runs
  // there.
  static readonly layer = Layer.unwrap(
    Effect.promise(() => import("cloudflare:workers")).pipe(
      Effect.flatMap(({ env }) => {
        const { PAPERS_DB, PAPERS, OPENAI_API_KEY, ANNOTATE } = env

        if (PAPERS_DB === undefined || PAPERS === undefined || ANNOTATE === undefined)
          return Effect.die("The Annotate Workflow needs PAPERS_DB, PAPERS and ANNOTATE")

        if (OPENAI_API_KEY === undefined)
          return Effect.die("The Annotate Workflow needs OPENAI_API_KEY")

        return Effect.succeed(
          Annotate.make(PAPERS).pipe(
            Layer.provide(D1Client.layer({ db: PAPERS_DB }).pipe(Layer.orDie)),
            Layer.provide(
              Annotator.openAi(Redacted.make(OPENAI_API_KEY)).pipe(
                Layer.provide(FetchHttpClient.layer),
              ),
            ),
            Layer.provide(Instances.make(ANNOTATE)),
            Layer.provide(Demand.layer),
          ),
        )
      }),
    ),
  )
}

// Runs `effect` as the step `name`, saving its answer as JSON, which
// Workflows can keep whatever its shape.
const kept = <A, I>(schema: Schema.Codec<A, I>, name: string, effect: Effect.Effect<A, unknown>) =>
  Effect.gen(function* () {
    const step = yield* Step
    const json = Schema.fromJsonString(schema)

    const saved = yield* step.run(
      name,
      effect.pipe(Effect.flatMap((value) => Schema.encodeEffect(json)(value))),
    )

    return yield* Schema.decodeEffect(json)(saved).pipe(Effect.orDie)
  })
