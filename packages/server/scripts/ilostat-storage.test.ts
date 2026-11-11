import { expect, it } from "@effect/vitest"
import { Effect, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"

import { storage } from "./ilostat-storage.ts"

it.effect("uses the real R2 object transport with an authenticated fake wire", () =>
  Effect.gen(function* () {
    const objects = new Map<string, string>()

    const wire: typeof fetch = async (input, init) => {
      const request = new Request(input, init)
      expect(request.headers.get("authorization")).toBe("Bearer test-token")
      const key = new URL(request.url).pathname

      if (request.method === "PUT") {
        objects.set(key, await request.text())

        return new Response("{}")
      }

      if (request.method === "DELETE") {
        objects.delete(key)

        return new Response("{}")
      }

      const value = objects.get(key)

      return value === undefined ? new Response(null, { status: 404 }) : new Response(value)
    }

    const bucket = yield* storage({
      account: "test-account",
      token: Redacted.make("test-token"),
      bucket: "test-series",
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, wire),
    )

    const key = "series/v2/ilostat/ILOSTAT:SDG_B552_NOC_RT_A"
    expect(yield* Effect.promise(() => bucket.get(key))).toBeNull()
    yield* Effect.promise(() =>
      bucket.put(key, '{"sample":true}', { customMetadata: { hash: "test-hash" } }),
    )
    const found = yield* Effect.promise(() => bucket.get(key))
    expect(yield* Effect.promise(() => found?.text() ?? Promise.resolve(""))).toBe(
      '{"sample":true}',
    )
    yield* Effect.promise(() => bucket.delete([key]))
    expect(yield* Effect.promise(() => bucket.get(key))).toBeNull()
  }),
)
