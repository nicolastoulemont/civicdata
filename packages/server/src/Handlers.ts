import { Api, type ConversationId } from "@civicdata/domain"
import { Effect, Layer } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

import { Agent } from "./Agent.ts"
import { AskLimit } from "./AskLimit.ts"
import { Catalog } from "./Catalog.ts"
import { Conversations } from "./Conversations.ts"
import { Notes } from "./Notes.ts"
import { PoliticsRoutes } from "./Politics.ts"
import { Resolver } from "./Resolver.ts"

const System = HttpApiBuilder.group(Api, "system", (handlers) =>
  handlers.handle("health", () => Effect.void),
)

const Views = HttpApiBuilder.group(
  Api,
  "views",
  Effect.fn(function* (handlers) {
    const resolver = yield* Resolver
    const agent = yield* Agent
    const limit = yield* AskLimit

    return handlers
      .handle("resolve", ({ payload }) => resolver.resolve(payload))
      .handle("explain", ({ payload, request }) =>
        limit
          .count(request.headers["cf-connecting-ip"] ?? "unknown")
          .pipe(Effect.andThen(agent.explain(payload))),
      )
  }),
)

const Indicators = HttpApiBuilder.group(
  Api,
  "indicators",
  Effect.fn(function* (handlers) {
    const notes = yield* Notes

    return handlers.handle("notes", ({ params, query }) => notes.get(params.indicator, query))
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
      .handleRaw("stop", forward)
      .handleRaw("show", forward)
      .handleRaw("vote", forward)
      .handleRaw("act", forward)
  }),
)

// Every API route, needing the Sources, Notes, a Catalog, Politics,
// Conversations, an Agent, an AskLimit and Directions.
export const Handlers = Layer.mergeAll(
  System,
  Views,
  Indicators,
  CatalogSearch,
  PoliticsRoutes,
  ConversationRoutes,
).pipe(Layer.provide(Resolver.layer))
