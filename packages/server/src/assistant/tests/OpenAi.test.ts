import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Predicate, Schema } from "effect"
import { LanguageModel } from "effect/ai"
import { HttpClient, HttpClientResponse } from "effect/http"

import { openAi } from "../OpenAi.ts"

const url = "https://api.openai.com/v1/responses"

// What a request to the Responses API names, of what the tests read.
const Sent = Schema.fromJsonString(
  Schema.Struct({ model: Schema.String, prompt_cache_key: Schema.optionalKey(Schema.String) }),
)

// The Responses API on the wire: it keeps each request's body and answers
// with a short message.
const responses = () => {
  const sent: Array<typeof Sent.Type> = []

  const client = HttpClient.make((request) =>
    Effect.gen(function* () {
      if (request.url !== url || !Predicate.isTagged(request.body, "Uint8Array")) {
        return yield* Effect.die(`Unexpected request to ${request.url}`)
      }

      sent.push(yield* Schema.decodeEffect(Sent)(new TextDecoder().decode(request.body.body)))

      return HttpClientResponse.fromWeb(
        request,
        Response.json({
          id: "resp_1",
          object: "response",
          created_at: 0,
          status: "completed",
          model: "gpt-6-luna",
          output: [
            {
              type: "message",
              id: "msg_1",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "Hello.", annotations: [] }],
            },
          ],
          usage: {
            input_tokens: 5000,
            input_tokens_details: { cached_tokens: 4096 },
            output_tokens: 10,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 5010,
          },
        }),
      )
    }).pipe(Effect.orDie),
  )

  return { sent, layer: Layer.succeed(HttpClient.HttpClient, client) }
}

describe("OpenAI", () => {
  it.effect("keys a conversation's requests to OpenAI's prompt cache", () => {
    const wire = responses()

    return Effect.gen(function* () {
      yield* LanguageModel.generateText({ prompt: "Life expectancy in Brazil" })
      yield* LanguageModel.generateText({ prompt: "Add Mexico" })

      expect(wire.sent.map((request) => request.prompt_cache_key)).toEqual([
        "conversation-1",
        "conversation-1",
      ])
    }).pipe(
      Effect.provide(
        openAi("sk-test", { cache: "conversation-1" }).pipe(Layer.provide(wire.layer)),
      ),
    )
  })

  it.effect("sends no cache key for a request outside a conversation", () => {
    const wire = responses()

    return Effect.gen(function* () {
      yield* LanguageModel.generateText({ prompt: "Explain this chart" })

      expect(wire.sent).toEqual([{ model: "gpt-6-luna" }])
    }).pipe(Effect.provide(openAi("sk-test").pipe(Layer.provide(wire.layer))))
  })
})
