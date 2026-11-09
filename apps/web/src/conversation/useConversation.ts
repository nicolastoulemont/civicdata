import {
  Answered,
  type ConversationId,
  Ended,
  Ending,
  put,
  type Step,
  TooManyQuestions,
  type Turn,
  type TurnIndex,
  type Turns,
  type View,
} from "@civicdata/domain"
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { DateTime, Effect, Option, Result, Schema, Stream, Struct } from "effect"
import { useEffect, useRef, useState } from "react"

import { call, page } from "@/api"
import { toQuery } from "@/explore/search"
import { record } from "@/history/store"

// The questions answered so far, and the one being answered, if any. Rejects
// with AgentUnavailable where conversations cannot be reached. Finished turns
// never change, so they stay fresh until a question is asked.
export const turnsQuery = (id: ConversationId) =>
  queryOptions({
    queryKey: ["conversation", id],
    queryFn: () => call(page, (api) => api.conversation.turns({ params: { id } })),
    retry: false,
    staleTime: (query) => (query.state.data?.answering === undefined ? Infinity : 0),
  })

const isEnding = Schema.is(Ending)

const isEnded = Schema.is(Ended)

const isAnswered = Schema.is(Answered)

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
    api.conversation.ask({ params: { id }, payload: { question } }).pipe(
      Effect.flatMap((steps) => read(steps, onStep)),
      Effect.result,
    ),
  )

// Follows the answer in progress from its first step.
const follow = (id: ConversationId, onStep: (step: Step) => void) =>
  call(page, (api) =>
    api.conversation.answer({ params: { id } }).pipe(
      Effect.flatMap((steps) => read(steps, onStep)),
      Effect.result,
    ),
  )

// Pending while this page asks a question or follows an answer, and on after
// the page leaves until the answer ends.
export const answerKey = (id: ConversationId) => ["conversation", id, "answer"]

// A question being answered here: one asked on this page, or one the server
// was already answering when the page opened. `before` counts the turns
// answered when it started, and `started` is when, in epoch milliseconds.
interface Pending {
  readonly question: string
  readonly via: "ask" | "follow"
  readonly before: number
  readonly started: number
}

type QuestionError = Result.Result.Failure<
  Awaited<ReturnType<typeof ask>> | Awaited<ReturnType<typeof follow>>
>

// A question whose answer failed, with the steps the agent took before it,
// each as it last was.
export interface Failure {
  readonly question: string
  readonly steps: ReadonlyArray<Step>
  readonly error: QuestionError
  readonly before: number
  readonly retryAt: number
}

// One conversation: its turns, the answer in progress with its steps so far,
// each as it last was, and how to ask the next question. A finished answer
// joins the turns. The server finishes an answer even when the page leaves,
// so the page follows one it finds in progress, and asks the server again
// when an answer is cut off.
export const useConversation = (id: ConversationId) => {
  const queryClient = useQueryClient()
  const conversation = useQuery(turnsQuery(id))
  const turns = useQuery({ ...turnsQuery(id), select: ({ answered }) => answered })
  const [failures, setFailures] = useState<ReadonlyArray<Failure>>([])
  const [steps, setSteps] = useState<ReadonlyArray<Step>>([])

  const asking = useMutation({
    mutationKey: answerKey(id),
    // Lists the conversation in this browser's sidebar.
    onMutate: ({ question, via }) => {
      if (via === "ask") record(id, question)
    },
    mutationFn: async ({ question, via }: Pending) => {
      let seen: ReadonlyArray<Step> = []

      const onStep = (step: Step) => {
        seen = put(seen, step)
        setSteps(seen)
      }

      setSteps([])

      const result = await (via === "ask" ? ask(id, question, onStep) : follow(id, onStep))

      return { result, steps: seen }
    },
    onSuccess: ({ result, steps: seen }, { question, before }) =>
      Result.match(result, {
        onSuccess: (ending) =>
          Option.match(ending, {
            onNone: () => queryClient.invalidateQueries({ queryKey: turnsQuery(id).queryKey }),
            // The saved turn carries how long the server took to answer. If
            // it cannot be read, the turn shows without that time.
            onSome: async (answer) => {
              const saved = await call(page, (api) =>
                api.conversation.turns({ params: { id } }),
              ).catch(() => undefined)

              queryClient.setQueryData(turnsQuery(id).queryKey, (previous?: Turns) =>
                saved !== undefined && saved.answered.length > before
                  ? saved
                  : {
                      answered: [
                        ...(previous?.answered ?? []),
                        { question, answer, steps: seen.filter(isEnded) },
                      ],
                    },
              )
            },
          }),
        onFailure: (error) => {
          setFailures((previous) => [
            ...previous,
            {
              question,
              steps: seen,
              error,
              before,
              retryAt: Date.now() + (error instanceof TooManyQuestions ? 60_000 : 0),
            },
          ])

          // The server may still be answering, or have answered since.
          return queryClient.invalidateQueries({ queryKey: turnsQuery(id).queryKey })
        },
      }),
  })

  // Asks the server to stop the answer in progress. The answer's own stream
  // then ends with Stopped, which joins the turns like any ending.
  const stopping = useMutation({
    mutationFn: () => call(page, (api) => api.conversation.stop({ params: { id } })),
  })

  const answered = conversation.data?.answered.length ?? 0
  const answering = conversation.data?.answering
  const { mutate, isPending } = asking

  const send = (question: string) =>
    mutate({ question, via: "ask", before: answered, started: Date.now() })

  // Follows an answer the server reports, once per report.
  const followed = useRef(0)

  useEffect(() => {
    if (answering === undefined || isPending || followed.current === conversation.dataUpdatedAt) {
      return
    }

    followed.current = conversation.dataUpdatedAt
    mutate({
      question: answering.question,
      via: "follow",
      before: answered,
      started: DateTime.toEpochMillis(answering.started),
    })
  }, [answering, answered, isPending, mutate, conversation.dataUpdatedAt])

  return {
    turns,
    failures: failures.filter(
      (failure) =>
        conversation.data?.answered[failure.before]?.question !== failure.question &&
        !(asking.isPending && asking.variables?.question === failure.question),
    ),
    retry: (failure: Failure) => {
      if (isPending || Date.now() < failure.retryAt) return
      setFailures((previous) => previous.filter((entry) => entry !== failure))
      send(failure.question)
    },
    // The question being answered, when it started, and what the agent did.
    pending:
      asking.variables === undefined || !asking.isPending
        ? undefined
        : { question: asking.variables.question, started: asking.variables.started, steps },
    answering: asking.isPending,
    stop: () => stopping.mutate(),
    stopping: stopping.isPending,
    ask: send,
  }
}

// The turn showing `view`: changed to it, or back when it is the agent's chart.
const showing = (turn: Turn, view: View): Turn =>
  isAnswered(turn.answer) && toQuery(turn.answer.view) === toQuery(view)
    ? Struct.omit(turn, ["shown"])
    : Struct.assign(turn, { shown: view })

// Keeps the chart a person changed a turn's chart to, one save at a time and
// in order. While a save runs, `variables` holds the chart to show; once the
// server keeps it, the saved conversation shows it too. Rejects with
// TurnNotFound, NoChart or AgentUnavailable, and the turn keeps its chart.
export const useShow = (id: ConversationId, turn: TurnIndex) => {
  const queryClient = useQueryClient()

  return useMutation({
    scope: { id: `conversation-${id}-turn-${turn}` },
    mutationFn: (view: View) =>
      call(page, (api) => api.conversation.show({ params: { id, turn }, payload: view })),
    onSuccess: (_, view) =>
      queryClient.setQueryData(turnsQuery(id).queryKey, (previous?: Turns) =>
        previous === undefined
          ? previous
          : Struct.evolve(previous, {
              answered: (answered) =>
                answered.map((each, index) => (index === turn ? showing(each, view) : each)),
            }),
      ),
  })
}

declare module "@tanstack/react-router" {
  interface HistoryState {
    // A question to ask once the conversation page opens.
    readonly question?: string
  }
}
