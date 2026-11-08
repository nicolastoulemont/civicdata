import { Api } from "@civicdata/domain"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

const System = HttpApiBuilder.group(Api, "system", (handlers) =>
  handlers.handle("health", () => Effect.void),
)

const Live = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(System),
  Layer.provide(HttpServer.layerServices),
)

// Workers forbid timers and random values at global scope, and toWebHandler
// starts building its layers as soon as it is called. Build on first request.
let handler: ((request: Request) => Promise<Response>) | undefined

export const handle = (request: Request): Promise<Response> =>
  (handler ??= HttpRouter.toWebHandler(Live).handler)(request)
