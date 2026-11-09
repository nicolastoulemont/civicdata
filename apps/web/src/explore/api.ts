import type { IndicatorId, View } from "@civicdata/domain"
import { keepPreviousData, queryOptions } from "@tanstack/react-query"

import { call, page } from "@/api"

import { toSearch } from "./search.ts"

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

// The agent's takeaway for a chart. Rejects with AgentUnavailable,
// TooManyQuestions or one of resolve's errors.
export const explain = (view: View) => call(page, (api) => api.views.explain({ payload: view }))

// What the World Bank says about an indicator beyond its definition. Rejects
// with IndicatorNotFound or SourceUnavailable.
export const notesQuery = (indicator: IndicatorId) =>
  queryOptions({
    queryKey: ["notes", indicator],
    queryFn: () => call(page, (api) => api.indicators.notes({ params: { indicator } })),
    retry: false,
    staleTime: 24 * 60 * 60 * 1000,
  })
