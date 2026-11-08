// The ambient declaration must reach every program that compiles this file,
// including apps/web; a .d.ts cannot be imported.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./cloudflare.d.ts" />

import { Context, Effect, Layer, Option } from "effect"

// What the cache needs from an R2 bucket binding.
export interface Bucket {
  readonly get: (key: string) => Promise<{ readonly text: () => Promise<string> } | null>
  readonly put: (key: string, value: string) => Promise<{ readonly key: string } | null>
}

interface Interface {
  readonly get: (key: string) => Effect.Effect<Option.Option<string>>
  readonly put: (key: string, value: string) => Effect.Effect<void>
}

// A best-effort key-value store. Failures are logged and read as misses, so a
// cache outage never breaks a chart.
export class Cache extends Context.Service<Cache, Interface>()("@civicdata/server/Cache") {
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

  // R2 inside Workers (deployed, or under `alchemy dev`). Plain `pnpm dev` runs
  // in Node, where `cloudflare:workers` does not exist, so it runs uncached.
  static readonly layer = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) => (env.CACHE === undefined ? Cache.none : Cache.r2(env.CACHE))),
      Effect.orElseSucceed(() => Cache.none),
    ),
  )
}
