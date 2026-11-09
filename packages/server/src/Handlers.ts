import { Api, type ConversationId } from "@civicdata/domain"
import { Effect, Layer } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

import { Catalog } from "./Catalog.ts"
import { Conversations } from "./Conversations.ts"
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

// A conversation's own Durable Object answers its requests, so they pass
// through unread: the Worker only checks the id in the path.
const ConversationRoutes = HttpApiBuilder.group(
  Api,
  "conversation",
  Effect.fn(function* (handlers) {
    const conversations = yield* Conversations

    const forward = ({
      params,
      request,
    }: {
      params: { id: ConversationId }
      request: HttpServerRequest.HttpServerRequest
    }) =>
      HttpServerRequest.toWeb(request).pipe(
        Effect.orDie,
        Effect.flatMap((web) => conversations.forward(params.id, web)),
        Effect.map(HttpServerResponse.fromWeb),
      )

    return handlers
      .handleRaw("turns", forward)
      .handleRaw("ask", forward)
      .handleRaw("answer", forward)
  }),
)

// Every API route, needing a WorldBank, an Sdmx, a Catalog and Conversations.
export const Handlers = Layer.mergeAll(System, Views, CatalogSearch, ConversationRoutes).pipe(
  Layer.provide(Resolver.layer),
)
