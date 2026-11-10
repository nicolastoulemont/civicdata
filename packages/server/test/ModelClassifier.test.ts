import { IndicatorId } from "@civicdata/domain"
import { beforeEach, describe, expect, it } from "@effect/vitest"
import { reset } from "cloudflare:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"

import { CatalogBuild } from "../src/CatalogBuild.ts"
import { Directions } from "../src/Directions.ts"
import { modelClassifier } from "../src/ModelClassifier.ts"
import { openAi as client } from "../src/OpenAi.ts"
import { catalogOver, listings, stored, worldBankList } from "./catalog.ts"
import recorded from "./fixtures/openai/directions.json?raw"

// The model's classifier over OpenAI's own client. It lives apart from the
// catalog build's tests: @effect/ai-openai's generated client is a 9 MB
// module, and loading it beside the build's graph made CI's workerd drop the
// file ("WebSocket protocol error: Message is too large").

beforeEach(() => reset())

const responses = "https://api.openai.com/v1/responses"

// The model's classifier over OpenAI's own client, with `fetch` faked: it
// answers every request to the Responses API with OpenAI's answer recorded on
// 2026-11-10 for test/catalog.ts's World Bank list (its encrypted reasoning
// item removed), and keeps each request's body.
const recordedOpenAi = () => {
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

// Each indicator's direction, as charts read it.
const read = (indicators: ReadonlyArray<IndicatorId>) =>
  Effect.gen(function* () {
    const directions = yield* Directions

    return yield* Effect.forEach(indicators, directions.of)
  }).pipe(Effect.provide(stored))

const surgeons = IndicatorId.make("SH.MED.SAOP.P5")
const richest = IndicatorId.make("SI.DST.10TH.10")
const growth = IndicatorId.make("SP.POP.GROW")
const population = IndicatorId.make("SP.POP.TOTL")

describe("modelClassifier", () => {
  it.effect(
    "asks OpenAI for the directions in one structured request and stores its answers",
    () => {
      const wire = recordedOpenAi()

      return Effect.gen(function* () {
        const catalog = yield* CatalogBuild

        yield* catalog.write("World Bank", 1)
        yield* catalog.publish("World Bank", 1)
        yield* catalog.classify("World Bank", 0)

        // OpenAI answered Higher for the surgeons, Neutral for the others.
        expect(yield* read([surgeons, richest, growth, population])).toEqual([
          "Higher",
          "Neutral",
          "Neutral",
          "Neutral",
        ])

        // One request, asking for the answer schema by name, about every entry.
        const [request, ...more] = wire.sent()

        expect(more).toEqual([])
        expect(request).toContain('"type":"json_schema","name":"directions"')

        for (const { indicator } of worldBankList) expect(request).toContain(indicator)
      }).pipe(
        Effect.provide(catalogOver(listings(), { classifier: wire.classifier })),
        Effect.provideService(FetchHttpClient.Fetch, wire.fetch),
      )
    },
  )
})
