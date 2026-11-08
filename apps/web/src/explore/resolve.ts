import { Api, type View } from "@civicdata/domain"
import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

import { toSearch } from "./search.ts"

const client = HttpApiClient.make(Api).pipe(Effect.provide(FetchHttpClient.layer))

// Rejects with the API's typed error (IndicatorNotFound, SourceUnavailable)
// or a transport error. Keyed by the URL form so equal Views share a cache
// entry. While an edited View loads, the previous result stays on screen so
// the chart and the open sections do not collapse.
export const resolveQuery = (view: View) =>
  queryOptions({
    queryKey: ["resolve", toSearch(view)],
    queryFn: () =>
      Effect.runPromise(client.pipe(Effect.flatMap((api) => api.views.resolve({ payload: view })))),
    retry: false,
    placeholderData: keepPreviousData,
  })
