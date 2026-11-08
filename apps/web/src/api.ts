import { Api } from "@civicdata/domain"
import { Effect, type Layer } from "effect"
import { FetchHttpClient, type HttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

// Where API requests go. A relative base URL resolves against the page.
export interface Transport {
  readonly baseUrl: string | undefined
  readonly layer: Layer.Layer<HttpClient.HttpClient>
}

export const page: Transport = { baseUrl: undefined, layer: FetchHttpClient.layer }

// Runs one request, rejecting with the API's typed error or a transport error.
export const call = <A, E>(
  transport: Transport,
  request: (api: HttpApiClient.ForApi<typeof Api>) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    HttpApiClient.make(Api, { baseUrl: transport.baseUrl }).pipe(
      Effect.flatMap(request),
      Effect.provide(transport.layer),
    ),
  )
