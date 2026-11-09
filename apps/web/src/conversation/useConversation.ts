import { type ConversationId, Ending, type Step, type Turn, Unanswered } from "@civicdata/domain"
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Effect, Option, Schema, Stream } from "effect"
import { useState } from "react"

import { call, page } from "@/api"

// The questions asked so far, each with how it was answered. Rejects with
// AgentUnavailable where conversations cannot be reached.
const turnsQuery = (id: ConversationId) =>
  queryOptions({
    queryKey: ["conversation", id],
    queryFn: () => call(page, (api) => api.conversation.turns({ params: { id } })),
    retry: false,
  })

const isEnding = Schema.is(Ending)

// How an answer ended: its last step. A stream that stops short of one, which
// the API does not send, reads as no answer.
const endingOf = (last: Option.Option<Step>): Ending =>
  Option.getOrElse(Option.filter(last, isEnding), () => Unanswered.make({}))

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
      Effect.map(endingOf),
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
    onSuccess: (answer, question) =>
      queryClient.setQueryData(turnsQuery(id).queryKey, (previous: ReadonlyArray<Turn> = []) => [
        ...previous,
        { question, answer },
      ]),
  })

  return {
    turns,
    // The question being answered or that failed, with what the agent did.
    pending:
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
