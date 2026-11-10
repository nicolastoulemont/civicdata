import { Effect, Layer, Schema, Stream } from "effect"
import { AiError, LanguageModel } from "effect/ai"

import { modelClassifier } from "../src/ModelClassifier.ts"
import { openAi as client } from "../src/OpenAi.ts"
import recorded from "./fixtures/openai/directions.json?raw"

const Asked = Schema.fromJsonString(Schema.Array(Schema.Struct({ indicator: Schema.String })))

// The model's classifier over a fake OpenAI model: it answers each indicator
// it is asked about with `answers[indicator]`, any string, and leaves out the
// rest. It records the indicators of each request; while `state.up` is
// false, every request fails.
export const fakeModel = (
  answers: Record<string, string> = {},
  state: { up: boolean } = { up: true },
) => {
  const asked: Array<ReadonlyArray<string>> = []

  const language = Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: ({ prompt }) =>
        Effect.gen(function* () {
          if (!state.up) {
            return yield* new AiError.AiError({
              module: "OpenAI",
              method: "generateText",
              reason: new AiError.UnknownError({ description: "upstream 500" }),
            })
          }

          const text = prompt.content
            .flatMap((message) => (message.role === "user" ? message.content : []))
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("")

          const indicators = (yield* Schema.decodeEffect(Asked)(text).pipe(Effect.orDie)).map(
            ({ indicator }) => indicator,
          )

          asked.push(indicators)

          const directions = indicators.flatMap((indicator) => {
            const direction = answers[indicator]

            return direction === undefined ? [] : [{ indicator, direction }]
          })

          return [
            { type: "text", text: JSON.stringify({ directions }) },
            { type: "finish", reason: "stop", usage: { inputTokens: {}, outputTokens: {} } },
          ] as const
        }),
      streamText: () => Stream.die("the classifier does not stream"),
    }),
  )

  return { classifier: modelClassifier.pipe(Layer.provide(language)), asked: () => asked }
}

const responses = "https://api.openai.com/v1/responses"

// The model's classifier over OpenAI's own client, with `fetch` faked: it
// answers every request to the Responses API with OpenAI's answer recorded on
// 2026-11-10 for test/catalog.ts's World Bank list (its encrypted reasoning
// item removed), and keeps each request's body.
export const recordedOpenAi = () => {
  const sent: Array<string> = []

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)

    if (request.url !== responses) throw new Error(`Unexpected request to ${request.url}`)

    sent.push(await request.text())

    return new Response(recorded, { headers: { "content-type": "application/json" } })
  }

  return {
    classifier: modelClassifier.pipe(Layer.provide(client("sk-test", undefined))),
    fetch,
    sent: () => sent,
  }
}
