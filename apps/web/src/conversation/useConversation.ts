import type { ConversationId, Step, Turn, View } from "@civicdata/domain"
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Effect, Match, Option, Stream } from "effect"
import { useState } from "react"

import { call, page } from "@/api"

// The questions asked so far, each with its chart. Rejects with
// AgentUnavailable where conversations cannot be reached.
const turnsQuery = (id: ConversationId) =>
  queryOptions({
    queryKey: ["conversation", id],
    queryFn: () => call(page, (api) => api.conversation.turns({ params: { id } })),
    retry: false,
  })

// The chart an answer ended with, or null when it found none.
const chartOf = (last: Option.Option<Step>): View | null =>
  Option.match(last, {
    onNone: () => null,
    onSome: (step) =>
      Match.valueTags(step, {
        Searched: () => null,
        Rejected: () => null,
        Answered: ({ view }) => view,
        Unanswered: () => null,
      }),
  })

// Asks a question, passing each step to `onStep` as it arrives. Rejects with
// TooManyQuestions or ConversationBusy before the answer starts, and with
// AgentUnavailable, SourceUnavailable or CatalogUnavailable during it.
const ask = (id: ConversationId, question: string, onStep: (step: Step) => void) =>
  call(page, (api) =>
    api.conversation.ask({ params: { id }, payload: { question } }).pipe(
      Effect.flatMap((steps) =>
        steps.pipe(
          Stream.tap((step) => Effect.sync(() => onStep(step))),
          Stream.runLast,
        ),
      ),
      Effect.map(chartOf),
    ),
  )

// One conversation: its turns, the answer in progress with the steps so far,
// and how to ask the next question. A finished answer joins the turns.
export const useConversation = (id: ConversationId) => {
  const queryClient = useQueryClient()
  const turns = useQuery(turnsQuery(id))
  const [steps, setSteps] = useState<ReadonlyArray<Step>>([])

  const asking = useMutation({
    mutationFn: (question: string) => {
      setSteps([])

      return ask(id, question, (step) => setSteps((previous) => [...previous, step]))
    },
    onSuccess: (view, question) =>
      queryClient.setQueryData(turnsQuery(id).queryKey, (previous: ReadonlyArray<Turn> = []) => [
        ...previous,
        { question, view },
      ]),
  })

  return {
    turns,
    // The question being answered or that failed, with what the agent did.
    asked:
      asking.isPending || asking.isError
        ? { question: asking.variables, steps, error: asking.error ?? undefined }
        : undefined,
    answering: asking.isPending,
    ask: asking.mutate,
  }
}

declare module "@tanstack/react-router" {
  interface HistoryState {
    // A question to ask once the conversation page opens.
    readonly question?: string
  }
}
