import { type ConversationId, Ending, type Step, type Turns } from "@civicdata/domain"
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Effect, Option, Schema, Stream } from "effect"
import { useEffect, useRef, useState } from "react"

import { call, page } from "@/api"
import { record } from "@/history/store"

// The questions answered so far, and the one being answered, if any. Rejects
// with AgentUnavailable where conversations cannot be reached.
export const turnsQuery = (id: ConversationId) =>
  queryOptions({
    queryKey: ["conversation", id],
    queryFn: () => call(page, (api) => api.conversation.turns({ params: { id } })),
    retry: false,
  })

const isEnding = Schema.is(Ending)

// Passes each step of an answer to `onStep`, then resolves with how it ended:
// its last step. An answer the server was not giving has no steps.
const read = <E>(steps: Stream.Stream<Step, E>, onStep: (step: Step) => void) =>
  steps.pipe(
    Stream.tap((step) => Effect.sync(() => onStep(step))),
    Stream.runLast,
    Effect.map(Option.filter(isEnding)),
  )

// Asks a question. Rejects with TooManyQuestions or ConversationBusy before
// the answer starts, and with AgentUnavailable, SourceUnavailable or
// CatalogUnavailable during it.
const ask = (id: ConversationId, question: string, onStep: (step: Step) => void) =>
  call(page, (api) =>
    api.conversation
      .ask({ params: { id }, payload: { question } })
      .pipe(Effect.flatMap((steps) => read(steps, onStep))),
  )

// Follows the answer in progress from its first step.
const follow = (id: ConversationId, onStep: (step: Step) => void) =>
  call(page, (api) =>
    api.conversation
      .answer({ params: { id } })
      .pipe(Effect.flatMap((steps) => read(steps, onStep))),
  )

// Pending while this page asks a question or follows an answer, and on after
// the page leaves until the answer ends.
export const answerKey = (id: ConversationId) => ["conversation", id, "answer"]

// A question being answered here: one asked on this page, or one the server
// was already answering when the page opened. `before` counts the turns
// answered when it started.
interface Pending {
  readonly question: string
  readonly via: "ask" | "follow"
  readonly before: number
}

// One conversation: its turns, the answer in progress with the steps so far,
// and how to ask the next question. A finished answer joins the turns. The
// server finishes an answer even when the page leaves, so the page follows one
// it finds in progress, and asks the server again when an answer is cut off.
export const useConversation = (id: ConversationId) => {
  const queryClient = useQueryClient()
  const conversation = useQuery(turnsQuery(id))
  const turns = useQuery({ ...turnsQuery(id), select: ({ answered }) => answered })
  const [steps, setSteps] = useState<ReadonlyArray<Step>>([])

  const asking = useMutation({
    mutationKey: answerKey(id),
    // Lists the conversation in this browser's sidebar.
    onMutate: ({ question, via }) => {
      if (via === "ask") record(id, question)
    },
    mutationFn: ({ question, via }: Pending) => {
      const onStep = (step: Step) => setSteps((previous) => [...previous, step])

      setSteps([])

      return via === "ask" ? ask(id, question, onStep) : follow(id, onStep)
    },
    onSuccess: (ending, { question }) =>
      Option.match(ending, {
        onNone: () => queryClient.invalidateQueries({ queryKey: turnsQuery(id).queryKey }),
        onSome: (answer) =>
          queryClient.setQueryData(turnsQuery(id).queryKey, (previous?: Turns) => ({
            answered: [...(previous?.answered ?? []), { question, answer }],
          })),
      }),
    // The server may still be answering, or have answered since.
    onError: () => queryClient.invalidateQueries({ queryKey: turnsQuery(id).queryKey }),
  })

  const answered = conversation.data?.answered.length ?? 0
  const answering = conversation.data?.answering
  const { mutate, isPending } = asking

  // Follows an answer the server reports, once per report.
  const followed = useRef(0)

  useEffect(() => {
    if (answering === undefined || isPending || followed.current === conversation.dataUpdatedAt) {
      return
    }

    followed.current = conversation.dataUpdatedAt
    mutate({ question: answering, via: "follow", before: answered })
  }, [answering, answered, isPending, mutate, conversation.dataUpdatedAt])

  // A failed question stays on the page until the server shows it answered.
  const failed =
    asking.isError && asking.variables !== undefined && answered <= asking.variables.before

  return {
    turns,
    // The question being answered or that failed, with what the agent did.
    pending:
      asking.isPending || failed
        ? { question: asking.variables?.question, steps, error: asking.error ?? undefined }
        : undefined,
    answering: asking.isPending,
    ask: (question: string) => mutate({ question, via: "ask", before: answered }),
  }
}

declare module "@tanstack/react-router" {
  interface HistoryState {
    // A question to ask once the conversation page opens.
    readonly question?: string
  }
}
