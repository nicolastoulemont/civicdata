import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"

import * as Fetch from "../Fetch.ts"

describe("Fetch", () => {
  it.effect("names the app in the request a publisher receives", () => {
    const received: Array<string | null> = []

    // The platform's fetch: what leaves the Worker.
    const wire: typeof globalThis.fetch = (input, init) => {
      received.push(new Request(input, init).headers.get("user-agent"))

      return Promise.resolve(new Response("{}"))
    }

    return Effect.gen(function* () {
      yield* HttpClient.get("https://bulks-faostat.fao.org/production/datasets_E.json")

      expect(received).toEqual(["openfacts (+https://openfacts.app)"])
    }).pipe(Effect.provide(Fetch.layer), Effect.provideService(FetchHttpClient.Fetch, wire))
  })
})
