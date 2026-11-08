import { handle } from "@civicdata/server"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

const send = (path: string, init?: RequestInit) =>
  Effect.promise(() => handle(new Request(new URL(path, "https://civicdata.test"), init)))

describe("api", () => {
  it.effect("reports health", () =>
    Effect.gen(function* () {
      const response = yield* send("/api/health")

      expect(response.status).toBe(204)
    }),
  )

  it.effect("returns 404 for an unknown route", () =>
    Effect.gen(function* () {
      const response = yield* send("/api/nope")

      expect(response.status).toBe(404)
    }),
  )

  // Rejected while decoding the payload, before any request to the World Bank.
  it.effect("rejects a view whose years run backwards", () =>
    Effect.gen(function* () {
      const response = yield* send("/api/views/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: `{"_tag":"Trend","indicator":"SP.POP.TOTL","countries":["FRA"],"from":2020,"to":2019}`,
      })

      expect(response.status).toBe(400)
    }),
  )

  it.effect("rejects an indicator search shorter than two characters", () =>
    Effect.gen(function* () {
      const response = yield* send("/api/catalog/search?q=p")

      expect(response.status).toBe(400)
    }),
  )
})
