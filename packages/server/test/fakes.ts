import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

import { Cache } from "../src/Cache.ts"
import type { Storage } from "../src/Transcript.ts"

// An HttpClient that answers every request with `respond`, never the network.
export const http = (respond: (url: string) => Response) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, respond(request.url))),
    ),
  )

// For tests that need no source: everything is missing.
export const offline = http(() => new Response("not recorded", { status: 404 }))

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

// Durable Object storage in memory, recording each alarm set.
export const memoryStorage = (values = new Map<string, string>()) => {
  const alarms: Array<number> = []

  const fake: Storage = {
    get: (key) => Promise.resolve(values.get(key)),
    put: (key, value) => Promise.resolve(void values.set(key, value)),
    setAlarm: (time) => Promise.resolve(void alarms.push(time)),
  }

  return { fake, alarms }
}
