import { Api } from "@civicdata/domain"
import { Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { Resolver } from "./Resolver.ts"

const System = HttpApiBuilder.group(Api, "system", (handlers) =>
  handlers.handle("health", () => Effect.void),
)

const Views = HttpApiBuilder.group(
  Api,
  "views",
  Effect.fn(function* (handlers) {
    const resolver = yield* Resolver

    return handlers.handle("resolve", ({ payload }) => resolver.resolve(payload))
  }),
)

// Every API route, needing only the Resolver's dependencies.
export const Handlers = Layer.mergeAll(System, Views).pipe(Layer.provide(Resolver.layer))
