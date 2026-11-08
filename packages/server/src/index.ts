import { Api } from "@civicdata/domain"
import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

import { Agent } from "./Agent.ts"
import { AskLimit } from "./AskLimit.ts"
import { Catalog } from "./Catalog.ts"
import { Handlers } from "./Handlers.ts"
import { Resolver } from "./Resolver.ts"
import { WorldBank } from "./WorldBank.ts"

const Live = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(Handlers),
  Layer.provide(Agent.live.pipe(Layer.provide(Resolver.layer))),
  Layer.provide(AskLimit.live),
  Layer.provide(Catalog.live),
  Layer.provide(WorldBank.live),
  Layer.provide(HttpServer.layerServices),
)

let handler: ((request: Request) => Promise<Response>) | undefined

// Workers forbid timers and random values at global scope, and toWebHandler
// starts building its layers as soon as it is called. Build on first request.
export const handle = (request: Request): Promise<Response> =>
  (handler ??= HttpRouter.toWebHandler(Live).handler)(request)
