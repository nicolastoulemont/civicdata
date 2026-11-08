import { Api } from "@civicdata/domain"
import { Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { Catalog } from "./Catalog.ts"
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

const CatalogSearch = HttpApiBuilder.group(
  Api,
  "catalog",
  Effect.fn(function* (handlers) {
    const catalog = yield* Catalog

    return handlers.handle("search", ({ query }) => catalog.search(query.q))
  }),
)

// Every API route, needing a WorldBank and a Catalog.
export const Handlers = Layer.mergeAll(System, Views, CatalogSearch).pipe(
  Layer.provide(Resolver.layer),
)
