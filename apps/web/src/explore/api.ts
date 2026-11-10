import { Ranking, type Trend, type View } from "@civicdata/domain"
import { keepPreviousData, queryOptions, skipToken } from "@tanstack/react-query"
import { Match } from "effect"

import { call, page } from "@/api"

import { toSearch } from "./search.ts"

// Rejects with the API's typed error (IndicatorNotFound, SourceUnavailable,
// TransformNotApplicable) or a transport error.
export const resolve = (view: View, transport = page) =>
  call(transport, (api) => api.views.resolve({ payload: view }))

// A ranking over time fetches every year of its span whichever it shows, so
// it asks for its last: moving the slider asks for nothing.
const fetched = (view: View) =>
  Match.value(view).pipe(
    Match.tag("Ranking", (ranking) =>
      ranking.span === undefined ? ranking : Ranking.make({ ...ranking, year: ranking.span.to }),
    ),
    Match.orElse((other) => other),
  )

// Keyed by the URL form so equal Views share a cache entry. While an edited
// View loads, the previous result stays on screen so the chart and the open
// sections do not collapse. A resolved View carries when its data was
// retrieved, so it stays fresh. A ranking over time's result names the last
// year of its span, not the year on screen.
export const resolveQuery = (view: View) =>
  queryOptions({
    queryKey: ["resolve", toSearch(fetched(view))],
    queryFn: () => resolve(fetched(view)),
    retry: false,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
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

// What the agent says a chart shows. Rejects with AgentUnavailable,
// TooManyQuestions or one of resolve's errors.
export const explain = (view: View) => call(page, (api) => api.views.explain({ payload: view }))

// What the source writes about a View's indicator beyond its definition: the
// OECD's notes on the View's countries and series among them. Rejects with
// IndicatorNotFound or SourceUnavailable.
export const notesQuery = ({ indicator, countries, dimensions }: View) =>
  queryOptions({
    queryKey: ["notes", indicator, countries.join(","), dimensions],
    queryFn: () =>
      call(page, (api) =>
        api.indicators.notes({
          params: { indicator },
          query: dimensions === undefined ? { countries } : { countries, dimensions },
        }),
      ),
    retry: false,
    // While another country's notes load, the indicator's stay on screen.
    placeholderData: (previous) => (previous?.indicator === indicator ? previous : undefined),
    staleTime: 24 * 60 * 60 * 1000,
  })

// The elections and governments of a trend's countries during its years;
// nothing is asked without a trend. Rejects with PoliticsUnavailable before the records are
// first stored, or outside Workers, or a transport error. The records change
// weekly at most.
export const politicsQuery = (trend: Trend | undefined) =>
  queryOptions({
    queryKey: ["politics", trend?.countries.join(","), trend?.from, trend?.to],
    queryFn:
      trend === undefined
        ? skipToken
        : () =>
            call(page, (api) =>
              api.politics.records({
                query: { countries: trend.countries, from: trend.from, to: trend.to },
              }),
            ),
    retry: false,
    placeholderData: keepPreviousData,
    staleTime: 60 * 60 * 1000,
  })
