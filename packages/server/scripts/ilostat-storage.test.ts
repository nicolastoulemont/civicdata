import { expect, it } from "@effect/vitest"
import { IndicatorId, Year } from "@repo/domain"
import { DateTime, Effect, Redacted, Stream } from "effect"
import { FetchHttpClient } from "effect/http"

import { Store } from "../src/Store.ts"
import { storage } from "./ilostat-storage.ts"

const objects = () => {
  const held = new Map<string, { text: string; headers: Record<string, string> }>()

  const wire: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    expect(url.origin).toBe("https://test-account.r2.cloudflarestorage.com")
    expect(request.headers.get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=test-access\//,
    )
    const key = url.pathname

    if (request.method === "PUT") {
      const text = await request.text()

      if (init?.body instanceof ReadableStream && !request.headers.has("content-length"))
        return new Response(null, { status: 411 })

      if (request.headers.get("if-none-match") === "*" && held.has(key))
        return new Response(null, { status: 412 })

      const headers = Object.fromEntries(
        [...request.headers].filter(([name]) => name.startsWith("x-amz-meta-")),
      )

      held.set(key, { text, headers })

      return new Response(null, { status: 200 })
    }

    if (request.method === "DELETE") {
      held.delete(key)

      return new Response(null, { status: 204 })
    }

    const value = held.get(key)

    return value === undefined
      ? new Response(null, { status: 404 })
      : new Response(value.text, { headers: value.headers })
  }

  return wire
}

const bucket = () =>
  storage({
    account: "test-account",
    accessKeyId: Redacted.make("test-access"),
    secretAccessKey: Redacted.make("test-secret"),
    bucket: "test-series",
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, objects()),
  )

it.effect("preserves metadata and conditional writes through the signed R2 wire", () =>
  Effect.gen(function* () {
    const target = yield* bucket()
    const key = "series/v2/ilostat/ILOSTAT:SDG_B552_NOC_RT_A"
    expect(yield* Effect.promise(() => target.get(key))).toBeNull()
    yield* Effect.promise(() =>
      target.put(key, '{"sample":"é"}', { customMetadata: { hash: "test-hash" } }),
    )
    const found = yield* Effect.promise(() => target.get(key))
    expect(found?.customMetadata).toEqual({ hash: "test-hash" })
    expect(yield* Effect.promise(() => found?.text() ?? Promise.resolve(""))).toBe('{"sample":"é"}')
    expect(
      yield* Effect.promise(() =>
        target.put(key, "replacement", {
          customMetadata: { hash: "changed" },
          onlyIf: { etagDoesNotMatch: "*" },
        }),
      ),
    ).toBeNull()

    const unchanged = yield* Effect.promise(() => target.get(key))
    expect(yield* Effect.promise(() => unchanged?.text() ?? Promise.resolve(""))).toBe(
      '{"sample":"é"}',
    )
    yield* Effect.promise(() => target.delete([key]))
    expect(yield* Effect.promise(() => target.get(key))).toBeNull()
  }),
)

it.effect("keeps a staged release immutable through the real storage transport", () =>
  Effect.gen(function* () {
    const transport = yield* bucket()
    const indicator = IndicatorId.make("SP.POP.TOTL")

    const stored = {
      indicator: { id: indicator, name: "Population", definition: "Population" },
      dataset: "World Bank",
      dimensions: {},
      version: "test-release",
      retrievedAt: DateTime.makeUnsafe("2026-11-11T00:00:00Z"),
      observations: [{ country: "FRA" as const, year: Year.make(2025), value: 1 }],
    }

    yield* Effect.gen(function* () {
      const release = (yield* Store).namespace("test-release")
      yield* Stream.runDrain(release.write(indicator, Stream.make(stored)))

      const result = yield* Stream.runDrain(
        release.write(
          indicator,
          Stream.make({
            ...stored,
            observations: [{ country: "FRA", year: Year.make(2025), value: 2 }],
          }),
        ),
      ).pipe(Effect.result)

      expect(result).toHaveProperty("failure._tag", "StoreUnavailable")
      expect(yield* release.read({ indicator, dimensions: {} })).toMatchObject({
        value: { observations: [{ value: 1 }] },
      })
    }).pipe(Effect.provide(Store.r2(transport)))
  }),
)
