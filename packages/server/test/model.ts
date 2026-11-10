import { Effect, Layer, Schema, Stream } from "effect"
import { AiError, LanguageModel } from "effect/ai"

import { modelClassifier } from "../src/ModelClassifier.ts"

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
