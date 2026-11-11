import { D1Client } from "@effect/sql-d1"
import {
  type Action,
  ChartIndex,
  Down,
  Ended,
  Ending,
  type Turn,
  TurnIndex,
  View,
  Vote,
} from "@openfacts/domain"
import { Context, DateTime, Duration, Effect, Exit, Layer, Option, Schema } from "effect"
import { SqlClient } from "effect/sql"

import { defaultModel } from "./model.ts"

// A chart a person changed before asking: the turn and place of the agent's
// chart, and the chart on screen there.
const Edited = Schema.Struct({ turn: TurnIndex, chart: ChartIndex, view: View })

interface Edited extends Schema.Schema.Type<typeof Edited> {}

// What an answer was asked with, besides its turn: when the question came,
// the questions asked before it in the conversation, oldest first, and the
// charts the person changed since the model last heard of them.
interface Asked {
  readonly asked: DateTime.Utc
  readonly earlier: ReadonlyArray<string>
  readonly changed: ReadonlyArray<Edited>
}

interface Interface {
  // Keeps an answer once its turn is saved. Never fails: a write that fails
  // or takes over 5 seconds is logged on the span and dropped, as for vote.
  readonly log: (turn: Turn, asked: Asked) => Effect.Effect<void>
  // Keeps what the person thought of the answer at `turn`, replacing their
  // earlier vote. An answer that was never logged keeps no vote.
  readonly vote: (turn: TurnIndex, vote: Vote) => Effect.Effect<void>
  // Counts one more change of the answer's charts, download of their data or
  // copy of their link. An answer that was never logged counts nothing.
  readonly count: (turn: TurnIndex, what: Tally) => Effect.Effect<void>
}

// What the person did with an answer's charts.
type Tally = Action | "change"

// How long a row is kept.
const keep = Duration.days(365)

const writeLimit = Duration.seconds(5)

// Text that names or reaches a person: an email address, or a run of nine or
// more digits, such as a phone, card or account number, with up to two
// spaces, dots, dashes or brackets between digits. A run ending in 000 is a
// round figure, such as "1 000 000 000 people", and stays. A year or a range
// of years has fewer digits.
const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const number = /\+?\d(?:[ .()-]{0,2}\d){8,}/g

const isRound = (digits: string) => digits.endsWith("000")

// A question with every email address and long number replaced.
export const scrub = (question: string) =>
  question
    .replaceAll(email, "[email]")
    .replaceAll(number, (run) => (isRound(run) ? run : "[number]"))

// The columns stored as JSON.
const Row = Schema.Struct({
  questions: Schema.fromJsonString(Schema.Array(Schema.String)),
  changed: Schema.fromJsonString(Schema.Array(Edited)),
  ending: Schema.fromJsonString(Ending),
  steps: Schema.fromJsonString(Schema.Array(Ended)),
})

const VoteJson = Schema.fromJsonString(Vote)

const isDown = Schema.is(Down)

// One row per answer kept: its questions scrubbed, how it ended and what the
// agent did, the model and version that answered, its trace, and the
// person's vote and what they did with its charts. Nothing in a row names the conversation: its id lets anyone
// read it. A row's id is a hash of the conversation's object and the turn's
// place (see idOf).
const tables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY,
      asked TEXT NOT NULL,
      questions TEXT NOT NULL,
      changed TEXT NOT NULL,
      ending TEXT NOT NULL,
      steps TEXT NOT NULL,
      took INTEGER,
      model TEXT NOT NULL,
      version TEXT,
      trace TEXT,
      vote TEXT,
      changes INTEGER NOT NULL DEFAULT 0,
      downloads INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0
    )
  `
  yield* sql`CREATE INDEX IF NOT EXISTS answers_asked ON answers (asked)`

  // Tables made before votes and counts were kept have no columns for them.
  const columns = new Set(
    (yield* sql<{ readonly name: string }>`PRAGMA table_info(answers)`).map(({ name }) => name),
  )

  if (!columns.has("vote")) yield* sql`ALTER TABLE answers ADD COLUMN vote TEXT`

  for (const column of ["changes", "downloads", "shares"]) {
    if (!columns.has(column)) {
      yield* sql`ALTER TABLE answers ADD COLUMN ${sql(column)} INTEGER NOT NULL DEFAULT 0`
    }
  }
})

// The column that counts each tally.
const columnOf = { change: "changes", download: "downloads", share: "shares" } as const

// The id of the row for the answer at `turn`: a SHA-256 hash of the
// conversation's Durable Object id and the turn's place, so a vote finds its
// row with nothing more stored. Only this Worker can compute an object's id
// from a conversation's link, and the hash cannot be turned back into it. A
// conversation deleted and then asked again from the same link reuses its
// object, so its new turns replace the old rows at the same places.
const idOf = Effect.fnUntraced(function* (conversation: string, turn: number) {
  const digest = yield* Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${conversation}/${turn}`)),
  )

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
})

// Logs and drops a write that fails or takes too long.
const kept = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.timeout(writeLimit),
    Effect.catchCause((cause) => Effect.logWarning("Answer not logged", cause)),
  )

// Where answers come from: the conversation's Durable Object id, the model,
// and the commit deployed, if known.
interface Source {
  readonly conversation: string
  readonly model: string
  readonly version: string | undefined
}

// The answers people got, kept a year so the bad ones can be found and turned
// into eval cases after their conversation is gone (docs/answers.md).
export class Answers extends Context.Service<Answers, Interface>()("@openfacts/server/Answers") {
  // Needs a SqlClient.
  static readonly layer = ({ conversation, model, version }: Source) =>
    Layer.effect(
      Answers,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient

        // Made once per object, on its first answer; a failure is tried
        // again on the next.
        const ready = yield* Effect.cachedWithTTL(
          tables.pipe(Effect.provideService(SqlClient.SqlClient, sql)),
          (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
        )

        const log = Effect.fn("Answers.log")(function* (
          turn: Turn,
          { asked, earlier, changed }: Asked,
        ) {
          const trace = yield* Effect.currentSpan.pipe(
            Effect.map((span) => span.traceId),
            Effect.option,
          )

          const row = yield* Schema.encodeEffect(Row)({
            questions: [...earlier, turn.question].map(scrub),
            changed,
            ending: turn.answer,
            steps: turn.steps ?? [],
          })

          const now = yield* DateTime.now

          const id = yield* idOf(conversation, earlier.length)

          yield* ready
          yield* sql`
              INSERT OR REPLACE INTO answers (id, asked, questions, changed, ending, steps, took, model, version, trace)
              VALUES (
                ${id},
                ${DateTime.formatIso(asked)},
                ${row.questions},
                ${row.changed},
                ${row.ending},
                ${row.steps},
                ${turn.took === undefined ? null : Duration.toMillis(turn.took)},
                ${model},
                ${version ?? null},
                ${Option.getOrNull(trace)}
              )
            `
          yield* sql`
              DELETE FROM answers
              WHERE asked < ${DateTime.formatIso(DateTime.subtractDuration(now, keep))}
            `
        }, kept)

        const vote = Effect.fn("Answers.vote")(function* (turn: TurnIndex, choice: Vote) {
          yield* Effect.annotateCurrentSpan("civicdata.vote", isDown(choice) ? "down" : "up")

          if (isDown(choice) && choice.reason !== undefined) {
            yield* Effect.annotateCurrentSpan("civicdata.vote.reason", choice.reason)
          }

          const id = yield* idOf(conversation, turn)
          const json = yield* Schema.encodeEffect(VoteJson)(choice)

          yield* ready
          yield* sql`UPDATE answers SET vote = ${json} WHERE id = ${id}`
        }, kept)

        const count = Effect.fn("Answers.count")(function* (turn: TurnIndex, what: Tally) {
          yield* Effect.annotateCurrentSpan("civicdata.answer.action", what)

          const id = yield* idOf(conversation, turn)
          const column = sql(columnOf[what])

          yield* ready
          yield* sql`UPDATE answers SET ${column} = ${column} + 1 WHERE id = ${id}`
        }, kept)

        return Answers.of({ log, vote, count })
      }),
    )

  // Keeps nothing: outside Workers, and in the eval.
  static readonly none = Layer.succeed(
    Answers,
    Answers.of({ log: () => Effect.void, vote: () => Effect.void, count: () => Effect.void }),
  )

  // The answers of the conversation whose Durable Object has this id, in D1
  // inside Workers (deployed, or under `alchemy dev`). Plain `pnpm dev:web`
  // runs in Node, where `cloudflare:workers` does not exist.
  static readonly live = (conversation: string) =>
    Layer.unwrap(
      Effect.tryPromise(() => import("cloudflare:workers")).pipe(
        Effect.map(({ env }) =>
          env.DB === undefined
            ? Answers.none
            : Answers.layer({
                conversation,
                model: env.OPENAI_MODEL ?? defaultModel,
                version: env.VERSION,
              }).pipe(Layer.provide(D1Client.layer({ db: env.DB }).pipe(Layer.orDie))),
        ),
        Effect.orElseSucceed(() => Answers.none),
      ),
    )
}
