import { handle } from "@civicdata/server"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

const get = (path: string) =>
  Effect.promise(() => handle(new Request(new URL(path, "https://civicdata.test"))))

describe("api", () => {
  it.effect("reports health", () =>
    Effect.gen(function* () {
      const response = yield* get("/api/health")
      expect(response.status).toBe(204)
    }),
  )

  it.effect("returns 404 for an unknown route", () =>
    Effect.gen(function* () {
      const response = yield* get("/api/nope")
      expect(response.status).toBe(404)
    }),
  )
})
