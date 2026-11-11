import { Api } from "@civicdata/domain"
import { Effect, Layer } from "effect"
import { FetchHttpClient, type HttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

import { traced } from "@/traces"

// Where API requests go. A relative base URL resolves against the page.
export interface Transport {
  readonly baseUrl: string | undefined
  readonly layer: Layer.Layer<HttpClient.HttpClient>
}

// The page's own origin, with the page's tracer: each request's span goes to
// the trace of what asked for it, and the server's spans continue it.
export const page: Transport = {
  baseUrl: undefined,
  layer: Layer.merge(
    FetchHttpClient.layer,
    Layer.unwrap(Effect.sync(() => Layer.effectContext(traced().contextEffect))),
  ),
}

// One request, failing with the API's typed error or a transport error.
// Interrupting it aborts the request.
export const request = <A, E>(
  transport: Transport,
  use: (api: HttpApiClient.ForApi<typeof Api>) => Effect.Effect<A, E>,
) =>
  HttpApiClient.make(Api, { baseUrl: transport.baseUrl }).pipe(
    Effect.flatMap(use),
    Effect.provide(transport.layer),
  )

// Runs one request, rejecting with the API's typed error or a transport error.
export const call = <A, E>(
  transport: Transport,
  use: (api: HttpApiClient.ForApi<typeof Api>) => Effect.Effect<A, E>,
) => Effect.runPromise(request(transport, use))
