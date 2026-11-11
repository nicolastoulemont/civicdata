import { Effect, Layer, Predicate, Redacted, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

import { modelClassifier } from "../src/ModelClassifier.ts"
import recorded from "./fixtures/openai/decisions.json?raw"

const url = "https://api.openai.com/v1/decisions"

// What a request asks: its questions, each named by an indicator.
const Asked = Schema.fromJsonString(
  Schema.Struct({ questions: Schema.Array(Schema.Struct({ name: Schema.String })) }),
)

// An answer of the Decisions API to a choice question.
const Answer = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("choice"),
    name: Schema.String,
    choice: Schema.String,
    confidence: Schema.Number,
    probabilities: Schema.Array(
      Schema.Struct({ value: Schema.String, probability: Schema.Number }),
    ),
  }),
  Schema.Struct({ type: Schema.Literal("refusal"), name: Schema.String }),
])

type Answer = typeof Answer.Type

const Recorded = Schema.fromJsonString(Schema.Struct({ answers: Schema.Array(Answer) }))

// Decisions answers to test/catalog.ts's lists, one per indicator.
const answered = new Map(
  Schema.decodeSync(Recorded)(recorded).answers.map((answer) => [answer.name, answer]),
)

export const chose = (name: string, choice: string, confidence: number): Answer => ({
  type: "choice",
  name,
  choice,
  confidence,
  probabilities: [],
})

export const refused = (name: string): Answer => ({ type: "refusal", name })

// The model's classifier over a fake Decisions API on the wire. It answers
// each question with the recorded answer of the same name, or with
// `answers[name]` when the test overrides it, and leaves out the questions
// named in `missing` and those with no answer. It keeps each request's
// body; while `state.up` is false, every request answers 500.
export const decisions = ({
  answers = {},
  missing = [],
  state = { up: true },
}: {
  answers?: Record<string, Answer>
  missing?: ReadonlyArray<string>
  state?: { up: boolean }
} = {}) => {
  const sent: Array<string> = []

  const client = HttpClient.make((request) =>
    Effect.gen(function* () {
      if (request.url !== url || !Predicate.isTagged(request.body, "Uint8Array")) {
        return yield* Effect.die(`Unexpected request to ${request.url}`)
      }

      const body = new TextDecoder().decode(request.body.body)

      sent.push(body)

      if (!state.up) {
        return HttpClientResponse.fromWeb(
          request,
          Response.json({ error: { message: "upstream 500" } }, { status: 500 }),
        )
      }

      const { questions } = yield* Schema.decodeEffect(Asked)(body).pipe(Effect.orDie)

      return HttpClientResponse.fromWeb(
        request,
        Response.json({
          model: "gpt-6-luna",
          answers: questions.flatMap(({ name }) => {
            const answer = answers[name] ?? answered.get(name)

            return answer === undefined || missing.includes(name) ? [] : [answer]
          }),
          usage: { input_tokens: 100 * questions.length, output_tokens: 0 },
        }),
      )
    }),
  )

  const asked = () =>
    sent.map((body) => Schema.decodeSync(Asked)(body).questions.map(({ name }) => name))

  return {
    classifier: modelClassifier(Redacted.make("sk-test")).pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    ),
    asked,
    sent: () => sent,
  }
}
