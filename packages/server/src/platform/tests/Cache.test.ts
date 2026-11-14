import { describe, expect, it } from "@effect/vitest"
import { env } from "cloudflare:workers"
import { Effect, Option } from "effect"

import { Cache } from "../Cache.ts"
import { type Bucket } from "../Cache.types.ts"

const failing: Bucket = {
  get: () => Promise.reject(new Error("R2 is down")),
  put: () => Promise.reject(new Error("R2 is down")),
}

describe("Cache", () => {
  it.effect("uses the Worker's R2 binding when it has one", () =>
    Effect.gen(function* () {
      const cache = yield* Cache

      yield* cache.put("series/a", "stored")

      expect(yield* cache.get("series/a")).toEqual(Option.some("stored"))
      expect(yield* Effect.promise(async () => (await env.CACHE?.get("series/a"))?.text())).toBe(
        "stored",
      )
      expect(yield* cache.get("series/missing")).toEqual(Option.none())
    }).pipe(Effect.provide(Cache.layer)),
  )

  it.effect("reads a failing bucket as a miss and drops its writes", () =>
    Effect.gen(function* () {
      const cache = yield* Cache

      yield* cache.put("series/a", "stored")

      expect(yield* cache.get("series/a")).toEqual(Option.none())
    }).pipe(Effect.provide(Cache.r2(failing))),
  )
})
