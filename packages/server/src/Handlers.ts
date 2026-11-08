import { Api } from "@civicdata/domain"
import { Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { Agent } from "./Agent.ts"
import { AskLimit } from "./AskLimit.ts"
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

const Ask = HttpApiBuilder.group(
  Api,
  "agent",
  Effect.fn(function* (handlers) {
    const agent = yield* Agent
    const limit = yield* AskLimit

    // Cloudflare sets cf-connecting-ip to the visitor's address.
    return handlers.handle("ask", ({ payload, request }) =>
      limit
        .count(request.headers["cf-connecting-ip"] ?? "unknown")
        .pipe(Effect.andThen(agent.ask(payload.question))),
    )
  }),
)

// Every API route, needing a WorldBank, a Catalog, an Agent and an AskLimit.
export const Handlers = Layer.mergeAll(System, Views, CatalogSearch, Ask).pipe(
  Layer.provide(Resolver.layer),
)
