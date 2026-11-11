import { ChartIndex, Ended, Ending, type Turn, TurnIndex, View } from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
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
  // or takes over 5 seconds is logged on the span and dropped.
  readonly log: (turn: Turn, asked: Asked) => Effect.Effect<void>
}

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

// One row per answer kept: its questions scrubbed, how it ended and what the
// agent did, the model and version that answered, and its trace. Nothing in a
// row names the conversation: its id lets anyone read it.
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
      trace TEXT
    )
  `
  yield* sql`CREATE INDEX IF NOT EXISTS answers_asked ON answers (asked)`
})

// The deployment that answers: the model, and the commit deployed, if known.
interface Deployment {
  readonly model: string
  readonly version: string | undefined
}

// The answers people got, kept a year so the bad ones can be found and turned
// into eval cases after their conversation is gone (docs/answers.md).
export class Answers extends Context.Service<Answers, Interface>()("@civicdata/server/Answers") {
  // Needs a SqlClient.
  static readonly layer = ({ model, version }: Deployment) =>
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

        const log = Effect.fn("Answers.log")(
          function* (turn: Turn, { asked, earlier, changed }: Asked) {
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

            yield* ready
            yield* sql`
              INSERT INTO answers (id, asked, questions, changed, ending, steps, took, model, version, trace)
              VALUES (
                ${crypto.randomUUID()},
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
          },
          (effect) =>
            effect.pipe(
              Effect.timeout(writeLimit),
              Effect.catchCause((cause) => Effect.logWarning("Answer not logged", cause)),
            ),
        )

        return Answers.of({ log })
      }),
    )

  // Keeps nothing: outside Workers, and in the eval.
  static readonly none = Layer.succeed(Answers, Answers.of({ log: () => Effect.void }))

  // D1 inside Workers (deployed, or under `alchemy dev`). Plain `pnpm dev:web`
  // runs in Node, where `cloudflare:workers` does not exist.
  static readonly live = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) =>
        env.DB === undefined
          ? Answers.none
          : Answers.layer({
              model: env.OPENAI_MODEL ?? defaultModel,
              version: env.VERSION,
            }).pipe(Layer.provide(D1Client.layer({ db: env.DB }).pipe(Layer.orDie))),
      ),
      Effect.orElseSucceed(() => Answers.none),
    ),
  )
}
