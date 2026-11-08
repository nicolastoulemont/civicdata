import { Api, type View } from "@civicdata/domain"
import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import { Effect, type Layer } from "effect"
import { FetchHttpClient, type HttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

import { toSearch } from "./search.ts"

// Where API requests go. A relative base URL resolves against the page.
export interface Transport {
  readonly baseUrl: string | undefined
  readonly layer: Layer.Layer<HttpClient.HttpClient>
}

const page: Transport = { baseUrl: undefined, layer: FetchHttpClient.layer }

const call = <A, E>(
  transport: Transport,
  request: (api: HttpApiClient.ForApi<typeof Api>) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    HttpApiClient.make(Api, { baseUrl: transport.baseUrl }).pipe(
      Effect.flatMap(request),
      Effect.provide(transport.layer),
    ),
  )

// Rejects with the API's typed error (IndicatorNotFound, SourceUnavailable,
// TransformNotApplicable) or a transport error.
export const resolve = (view: View, transport = page) =>
  call(transport, (api) => api.views.resolve({ payload: view }))

// Keyed by the URL form so equal Views share a cache entry. While an edited
// View loads, the previous result stays on screen so the chart and the open
// sections do not collapse.
export const resolveQuery = (view: View) =>
  queryOptions({
    queryKey: ["resolve", toSearch(view)],
    queryFn: () => resolve(view),
    retry: false,
    placeholderData: keepPreviousData,
  })

// Indicators matching what the user typed. Rejects with SourceUnavailable when
// the World Bank catalog cannot be loaded, or CatalogUnavailable outside Workers.
export const searchQuery = (text: string) =>
  queryOptions({
    queryKey: ["search", text],
    queryFn: () => call(page, (api) => api.catalog.search({ query: { q: text } })),
    enabled: text.length >= 2,
    retry: false,
    placeholderData: keepPreviousData,
    staleTime: 60 * 60 * 1000,
  })
