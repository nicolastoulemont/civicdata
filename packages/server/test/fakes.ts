import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

import { Cache } from "../src/Cache.ts"

// An HttpClient that answers every request with `respond`, never the network.
export const http = (respond: (url: string) => Response) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, respond(request.url))),
    ),
  )

// For tests that never reach a source.
export const offline = http(() => new Response("offline", { status: 503 }))

// A cache in memory whose entries the test can read and change.
export const memory = () => {
  const store = new Map<string, string>()

  const layer = Layer.succeed(
    Cache,
    Cache.of({
      get: (key) => Effect.sync(() => Option.fromNullishOr(store.get(key))),
      put: (key, value) =>
        Effect.sync(() => {
          store.set(key, value)
        }),
    }),
  )

  return { store, layer }
}
