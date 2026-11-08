import { Api } from "@civicdata/domain"
import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

import { Catalog } from "./Catalog.ts"
import { Conversations } from "./Conversations.ts"
import { Handlers } from "./Handlers.ts"
import { WorldBank } from "./WorldBank.ts"

export { ConversationObject } from "./ConversationObject.ts"

const Live = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(Handlers),
  Layer.provide(Conversations.live),
  Layer.provide(Catalog.live),
  Layer.provide(WorldBank.live),
  Layer.provide(HttpServer.layerServices),
)

let handler: ((request: Request) => Promise<Response>) | undefined

// Workers forbid timers and random values at global scope, and toWebHandler
// starts building its layers as soon as it is called. Build on first request.
export const handle = (request: Request): Promise<Response> =>
  (handler ??= HttpRouter.toWebHandler(Live).handler)(request)
