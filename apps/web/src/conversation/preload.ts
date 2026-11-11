import { chartsOf, type ConversationId } from "@openfacts/domain"
import type { QueryClient } from "@tanstack/react-query"
import { createIsomorphicFn } from "@tanstack/react-start"

import { resolveQuery } from "@/explore/api"

import { turnsQuery } from "./useConversation.ts"

export interface PreloadOptions {
  queryClient: QueryClient
  id: ConversationId
}

// Fills the query cache with a conversation's turns, then its charts, from
// what this browser saved or from the server. A conversation that cannot be
// loaded is left to its page, which shows why.
const load = async ({ queryClient, id }: PreloadOptions) => {
  const { answered } = await queryClient.ensureQueryData(turnsQuery(id))

  await Promise.all(
    answered.flatMap(({ answer }) =>
      chartsOf(answer).map(({ view }) => queryClient.prefetchQuery(resolveQuery(view))),
    ),
  )
}

// Starts loading without holding up the page: a new conversation asks its
// first question at once, and a chart still loading shows a placeholder.
// Server rendering skips it: the server has no saved queries, and its query
// cache never reaches the browser.
export const preload = createIsomorphicFn().client((options: PreloadOptions) => {
  load(options).catch(() => undefined)
})
