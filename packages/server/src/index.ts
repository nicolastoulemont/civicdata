import { Api } from "@civicdata/domain"
import { Layer, ManagedRuntime } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

import { Agent } from "./Agent.ts"
import { AskLimit } from "./AskLimit.ts"
import { Catalog } from "./Catalog.ts"
import { Conversations } from "./Conversations.ts"
import { Directions } from "./Directions.ts"
import { Handlers } from "./Handlers.ts"
import { Notes } from "./Notes.ts"
import { Politics } from "./Politics.ts"
import { Resolver } from "./Resolver.ts"
import { Sdmx } from "./Sdmx.ts"
import * as Traces from "./Traces.ts"
import { WorldBank } from "./WorldBank.ts"

export { ConversationObject } from "./ConversationObject.ts"

export { PaceObject } from "./PaceObject.ts"

const Live = Layer.merge(
  HttpApiBuilder.layer(Api),
  Traces.proxy.pipe(Layer.provide(Traces.TraceLimit.live), Layer.provide(FetchHttpClient.layer)),
).pipe(
  Layer.provide(Handlers),
  Layer.provide(Conversations.live),
  Layer.provide(Agent.live.pipe(Layer.provide(Resolver.layer))),
  Layer.provide(AskLimit.live),
  Layer.provide(Catalog.live),
  Layer.provide(Politics.live),
  Layer.provide(Notes.live),
  Layer.provide(WorldBank.live),
  Layer.provide(Sdmx.live),
  Layer.provide(Directions.live),
  Layer.provide(HttpServer.layerServices),
)

// The API and the tracer its requests' spans go to.
const serve = () => {
  const runtime = ManagedRuntime.make(Traces.layer)

  const { handler } = HttpRouter.toWebHandler(
    Live.pipe(Layer.provideMerge(Layer.effectContext(runtime.contextEffect))),
  )

  return { runtime, handler }
}

let server: ReturnType<typeof serve> | undefined

// Workers forbid timers and random values at global scope, and toWebHandler
// starts building its layers as soon as it is called. Build on first request.
export const handle = async (request: Request): Promise<Response> => {
  server ??= serve()

  const response = await server.handler(request)

  await server.runtime.runPromise(Traces.settle)

  return response
}
