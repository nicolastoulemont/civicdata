import { Api } from "@repo/domain"
import { Layer } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

import { Agent } from "./assistant/Agent.ts"
import { AskLimit } from "./assistant/AskLimit.ts"
import { Conversations } from "./assistant/Conversations.ts"
import { Catalog } from "./catalog/Catalog.ts"
import { Directions } from "./catalog/Directions.ts"
import { Handlers } from "./Handlers.ts"
import * as Traces from "./platform/Traces.ts"
import { Politics } from "./politics/Politics.ts"
import { Notes } from "./sources/Notes.ts"
import { Sources } from "./sources/Sources.ts"
import { Verification } from "./Verification.ts"
import { Resolver } from "./views/Resolver.ts"

export { ConversationObject } from "./assistant/ConversationObject.ts"

export { PaceObject } from "./platform/PaceObject.ts"

const Live = Layer.mergeAll(
  HttpApiBuilder.layer(Api),
  Traces.locale,
  Traces.proxy.pipe(Layer.provide(Traces.TraceLimit.live), Layer.provide(FetchHttpClient.layer)),
).pipe(
  Layer.provide(Handlers),
  Layer.provide(Conversations.live),
  Layer.provide(Agent.live().pipe(Layer.provide(Resolver.layer))),
  Layer.provide(AskLimit.live),
  Layer.provide(Verification.live),
  Layer.provide(Catalog.live),
  Layer.provide(Politics.live),
  Layer.provide(Notes.live),
  Layer.provide(Sources.live),
  Layer.provide(Directions.live),
  Layer.provide(HttpServer.layerServices),
)

let handler: ((request: Request) => Promise<Response>) | undefined

// Workers forbid timers and random values at global scope, and toWebHandler
// starts building its layers as soon as it is called. Build on first request.
export const handle = (request: Request): Promise<Response> =>
  (handler ??= Traces.serve(HttpRouter.toWebHandler(Live).handler))(request)
