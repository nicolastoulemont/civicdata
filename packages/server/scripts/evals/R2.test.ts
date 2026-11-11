import { expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Fiber, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"

import { r2 } from "./R2.ts"
import { Store } from "./transfer.ts"

const configured = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    CLOUDFLARE_ACCOUNT_ID: "00000000000000000000000000000000",
    CLOUDFLARE_API_TOKEN: "test-only",
  }),
)

const remote = r2.pipe(Layer.provide(FetchHttpClient.layer))

it.effect("waits before retrying a rate-limited read", () =>
  Effect.gen(function* () {
    let attempts = 0

    const wire: typeof fetch = () => {
      attempts++

      return Promise.resolve(
        attempts === 1
          ? new Response(null, { status: 429, headers: { "retry-after": "60" } })
          : new Response("answer"),
      )
    }

    const read = Effect.gen(function* () {
      return yield* (yield* Store).get("answer")
    }).pipe(
      Effect.provide(remote),
      Effect.provideService(FetchHttpClient.Fetch, wire),
      Effect.provide(configured),
    )

    const fiber = yield* Effect.forkScoped(read)

    yield* TestClock.adjust("59 seconds")

    expect(attempts).toBe(1)
    yield* TestClock.adjust("1 second")

    expect(Option.isSome(yield* Fiber.join(fiber))).toBe(true)
    expect(attempts).toBe(2)
  }),
)

it.effect(
  "reads paginated R2 objects without an empty cursor and distinguishes missing objects",
  () => {
    const requests: Array<URL> = []

    const wire: typeof fetch = (input) => {
      const url = new URL(new Request(input).url)
      requests.push(url)

      if (url.pathname.endsWith("/missing"))
        return Promise.resolve(new Response(null, { status: 404 }))

      return Promise.resolve(
        Response.json(
          url.searchParams.has("cursor")
            ? { result: [{ key: "second" }], result_info: { cursor: null } }
            : { result: [{ key: "first" }], result_info: { cursor: "page2" } },
        ),
      )
    }

    return Effect.gen(function* () {
      const store = yield* Store

      expect(yield* store.list("evals/v1/runs/")).toEqual(["first", "second"])
      expect(requests[0]?.searchParams.has("cursor")).toBe(false)
      expect(requests[1]?.searchParams.get("cursor")).toBe("page2")
      expect(Option.isNone(yield* store.get("missing"))).toBe(true)
    }).pipe(
      Effect.provide(remote),
      Effect.provideService(FetchHttpClient.Fetch, wire),
      Effect.provide(configured),
    )
  },
)

const denied: typeof fetch = () => Promise.resolve(new Response(null, { status: 403 }))
const malformed: typeof fetch = () => Promise.resolve(Response.json({ result: "wrong" }))

it.effect("preserves denied access and malformed list responses as typed archive errors", () => {
  const get = Effect.gen(function* () {
    const store = yield* Store

    expect(yield* Effect.flip(store.get("answer"))).toMatchObject({
      operation: "R2.get",
    })
    expect(yield* Effect.flip(store.put("answer", new Uint8Array()))).toMatchObject({
      operation: "R2.put",
    })
  }).pipe(
    Effect.provide(remote),
    Effect.provideService(FetchHttpClient.Fetch, denied),
    Effect.provide(configured),
  )

  const invalid = Effect.gen(function* () {
    const store = yield* Store

    expect(yield* Effect.flip(store.list("evals/"))).toMatchObject({
      operation: "R2.list",
    })
  }).pipe(
    Effect.provide(remote),
    Effect.provideService(FetchHttpClient.Fetch, malformed),
    Effect.provide(configured),
  )

  return Effect.andThen(get, invalid)
})
