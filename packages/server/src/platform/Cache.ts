// The ambient declaration must reach every program that compiles this file,
// including apps/web; a .d.ts cannot be imported.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="../cloudflare.d.ts" />

import { SourceUnavailable } from "@repo/domain"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"

import type { Bucket } from "./Cache.types.ts"

interface Interface {
  readonly get: (key: string) => Effect.Effect<Option.Option<string>>
  readonly put: (key: string, value: string) => Effect.Effect<void>
}

interface Remembered<A, E> {
  readonly json: Schema.Codec<A, string>
  // Whether a result retrieved at `retrievedAt` may still be served at `now`.
  readonly fresh: (retrievedAt: DateTime.Utc, now: DateTime.Utc) => boolean
  readonly fetch: Effect.Effect<A, E>
}

// A best-effort key-value store. Failures are logged and read as misses, so a
// cache outage never breaks a chart.
export class Cache extends Context.Service<Cache, Interface>()("@repo/server/Cache") {
  static readonly r2 = (bucket: Bucket) =>
    Layer.succeed(
      Cache,
      Cache.of({
        get: (key) =>
          Effect.tryPromise(async () => {
            const object = await bucket.get(key)

            return object === null ? Option.none() : Option.some(await object.text())
          }).pipe(
            Effect.tapError((error) => Effect.logWarning("Cache read failed", key, error)),
            Effect.orElseSucceed(Option.none),
          ),
        put: (key, value) =>
          Effect.tryPromise(() => bucket.put(key, value)).pipe(
            Effect.tapError((error) => Effect.logWarning("Cache write failed", key, error)),
            Effect.ignore,
          ),
      }),
    )

  static readonly none = Layer.succeed(
    Cache,
    Cache.of({ get: () => Effect.succeedNone, put: () => Effect.void }),
  )

  // Serves the result stored under `key` while it is fresh, otherwise fetches
  // and stores the answer. An entry that no longer decodes is a miss. Results
  // keep their retrieval time, so a stored one still reports when its source
  // was asked; that is why a stale one is served when the source is
  // unavailable, such as while its request budget is spent.
  static readonly remember = Effect.gen(function* () {
    const cache = yield* Cache

    return Effect.fnUntraced(function* <A extends { readonly retrievedAt: DateTime.Utc }, E>(
      key: string,
      { json, fresh, fetch }: Remembered<A, E>,
    ) {
      const stored = Option.flatMap(yield* cache.get(key), Schema.decodeOption(json))
      const now = yield* DateTime.now

      const store = fetch.pipe(
        Effect.tap((answer) =>
          Schema.encodeEffect(json)(answer).pipe(
            Effect.flatMap((text) => cache.put(key, text)),
            Effect.tapError((error) => Effect.logWarning("Could not cache", key, error)),
            Effect.ignore,
          ),
        ),
      )

      if (Option.isNone(stored)) return yield* store

      if (fresh(stored.value.retrievedAt, now)) return stored.value

      return yield* store.pipe(
        Effect.catchIf(
          (error) => error instanceof SourceUnavailable,
          (error) =>
            Effect.logWarning("Serving a stale result", key, error).pipe(Effect.as(stored.value)),
        ),
      )
    })
  })

  // R2 inside Workers (deployed, or under `alchemy dev`). Plain `pnpm dev` runs
  // in Node, where `cloudflare:workers` does not exist, so it runs uncached.
  static readonly layer = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) => (env.CACHE === undefined ? Cache.none : Cache.r2(env.CACHE))),
      Effect.orElseSucceed(() => Cache.none),
    ),
  )
}
