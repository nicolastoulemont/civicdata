import {
  type Action,
  AgentUnavailable,
  type ChartIndex,
  chartsOf,
  type ConversationId,
  ConversationNotFound,
  Ended,
  Ending,
  put,
  type Step,
  TooManyQuestions,
  type Turn,
  type TurnIndex,
  type Turns,
  type View,
  type Vote,
  withShown,
} from "@openfacts/domain"
import { Machine } from "@openfacts/machine"
import {
  MutationObserver,
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Clock, Data, DateTime, Effect, Equal, Option, Schema, Stream, Struct } from "effect"
import { useEffect, useMemo } from "react"

import { call, page, request } from "@/api"
import { toQuery } from "@/explore/search"
import { record } from "@/history/store"
import { useMachine } from "@/machine"

// The questions answered so far, and the one being answered, if any. Rejects
// with ConversationNotFound before the first question and once the server
// deletes the conversation, and with AgentUnavailable where conversations
// cannot be reached. Finished turns never change, so they stay fresh until a
// question is asked.
export const turnsQuery = (id: ConversationId) =>
  queryOptions({
    queryKey: ["conversation", id],
    queryFn: () => call(page, (api) => api.conversation.turns({ params: { id } })),
    retry: false,
    staleTime: (query) => (query.state.data?.answering === undefined ? Infinity : 0),
  })

const isEnding = Schema.is(Ending)

const isEnded = Schema.is(Ended)

const none: ReadonlyArray<Turn> = []

// A question being answered here: one asked on this page, or one the server
// was already answering when the page opened. `before` counts the turns
// answered when it started, and `started` is when, in epoch milliseconds.
interface Pending {
  readonly question: string
  readonly via: "ask" | "follow"
  readonly before: number
  readonly started: number
}

// The steps of the answer to `pending`, asked or followed. Asking fails with
// TooManyQuestions or ConversationBusy before the answer starts, and either
// fails with AgentUnavailable or CatalogUnavailable during it, or dies when
// the server dies giving it. Following an answer the server was not giving
// has no steps. One span runs from the request to the last step; the
// server's spans of the answer sit inside it.
const stepsOf = (id: ConversationId, { question, via }: Pending) =>
  Stream.unwrap(
    request(page, (api) =>
      via === "ask"
        ? api.conversation.ask({ params: { id }, payload: { question } })
        : api.conversation.answer({ params: { id } }),
    ),
  ).pipe(
    Stream.withSpan(`question.${via}`, {
      attributes: { "gen_ai.conversation.id": id, "openfacts.question": question },
    }),
  )

type QuestionError = Stream.Error<ReturnType<typeof stepsOf>>

// The server restarted while it answered the question, and lost the answer.
export class AnswerLost extends Data.TaggedError("AnswerLost") {}

// A question whose answer failed, with the steps the agent took before it,
// each as it last was.
export interface Failure {
  readonly question: string
  readonly steps: ReadonlyArray<Step>
  readonly error: QuestionError | AnswerLost
  readonly before: number
  readonly retryAt: number
}

// Whether the answer in progress can be stopped: it can, a stop was sent and
// the answer has not ended yet, or the stop could not be sent.
type Stop = Data.TaggedEnum<{
  Ready: {}
  Sent: {}
  Failed: {}
}>

export const Stop = Data.taggedEnum<Stop>()

// The answer of one conversation: none in progress, or one running, with the
// steps the agent took so far, each as it last was. The questions that
// failed in this conversation stay with it either way.
type Answer = Data.TaggedEnum<{
  Idle: { readonly failures: ReadonlyArray<Failure> }
  Running: {
    readonly failures: ReadonlyArray<Failure>
    readonly pending: Pending
    readonly steps: ReadonlyArray<Step>
    readonly stop: Stop
  }
}>

const Answer = Data.taggedEnum<Answer>()

type Running = Data.TaggedEnum.Value<Answer, "Running">

// `reported` is the answer the server reports in progress once one ends or
// fails, if any: the page follows it next.
type Event = Data.TaggedEnum<{
  Ask: { readonly question: string; readonly before: number; readonly started: number }
  Retry: { readonly failure: Failure; readonly before: number; readonly started: number }
  Report: { readonly pending: Pending }
  Progress: { readonly step: Step }
  End: { readonly reported: Option.Option<Pending> }
  Fail: {
    readonly error: QuestionError
    readonly retryAt: number
    readonly reported: Option.Option<Pending>
  }
  Stop: {}
  StopFail: { readonly pending: Pending }
}>

const Event = Data.taggedEnum<Event>()

// The answer the server reports in progress, followed from its first step.
const following = ({ answered, answering }: Turns): Option.Option<Pending> =>
  Option.map(Option.fromNullishOr(answering), ({ question, started }) => ({
    question,
    via: "follow",
    before: answered.length,
    started: DateTime.toEpochMillis(started),
  }))

const start = (failures: ReadonlyArray<Failure>, pending: Pending) =>
  Answer.Running({ failures, pending, steps: [], stop: Stop.Ready() })

// Follows the answer the server reports, if any, or rests.
const settle = (failures: ReadonlyArray<Failure>, reported: Option.Option<Pending>) =>
  Option.match(reported, {
    onNone: () => Answer.Idle({ failures }),
    onSome: (pending) => start(failures, pending),
  })

// The failures, with the question the server lost as one more, once: asking
// it again here may have failed too.
const withLost = (
  failures: ReadonlyArray<Failure>,
  { lost, before }: { readonly lost: Turns["lost"]; readonly before: number },
): ReadonlyArray<Failure> =>
  lost === undefined ||
  failures.some((failure) => failure.question === lost.question && failure.before === before)
    ? failures
    : [
        ...failures,
        { question: lost.question, steps: [], error: new AnswerLost(), before, retryAt: 0 },
      ]

// Marks the conversation as answered by this page while `use` runs, for the
// sidebar to read through `answerKey`. The server finishes an answer even
// when the page leaves, so leaving before the answer ends records it as
// still in progress, and the sidebar asks the server until it ends.
const marked = <A, E>(
  client: QueryClient,
  { id, pending }: { id: ConversationId; pending: Pending },
  use: (done: () => void) => Stream.Stream<A, E>,
) =>
  Stream.unwrap(
    Effect.gen(function* () {
      let ended = false

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const { promise, resolve } = Promise.withResolvers<void>()

          void new MutationObserver(client, {
            mutationKey: answerKey(id),
            mutationFn: () => promise,
          }).mutate()

          return resolve
        }),
        (resolve) =>
          Effect.sync(() => {
            if (!ended) {
              client.setQueryData(turnsQuery(id).queryKey, (previous?: Turns) =>
                previous === undefined
                  ? previous
                  : Struct.assign(previous, {
                      answering: {
                        question: pending.question,
                        started: DateTime.makeUnsafe(pending.started),
                      },
                    }),
              )
            }

            resolve()
          }),
      )

      return use(() => {
        ended = true
      })
    }),
  )

// Asks the server for the turns again, and for the answer it reports in
// progress, if any. The server may still be answering, or have answered since.
// A read sent before the question may still be running, and could answer
// that the conversation does not exist, so it is dropped for a new one.
const refresh = (client: QueryClient, id: ConversationId) =>
  Effect.promise(async () => {
    const { queryKey } = turnsQuery(id)

    await client.cancelQueries({ queryKey })
    await client.invalidateQueries({ queryKey })
  }).pipe(
    Effect.map(() =>
      Option.flatMap(Option.fromNullishOr(client.getQueryData(turnsQuery(id).queryKey)), following),
    ),
  )

interface Answered {
  readonly id: ConversationId
  readonly pending: Pending
  readonly steps: ReadonlyArray<Step>
  readonly answer: Ending
}

// Keeps the answer with the turns: the saved turn carries how long the server
// took to answer, and if it cannot be read, the turn shows without that time.
// Turns that already hold the answer, such as a refetch while it ran brought,
// are kept as they are: the answer is the turn after the `before` first.
const keep = (client: QueryClient, { id, pending, steps, answer }: Answered) =>
  Effect.promise(() =>
    call(page, (api) => api.conversation.turns({ params: { id } })).catch(() => undefined),
  ).pipe(
    Effect.map((saved) => {
      client.setQueryData(turnsQuery(id).queryKey, (previous?: Turns) => {
        if (saved !== undefined && saved.answered.length > pending.before) return saved

        const answered = previous?.answered ?? []

        return answered.length > pending.before
          ? { answered }
          : {
              answered: [
                ...answered,
                { question: pending.question, answer, steps: steps.filter(isEnded) },
              ],
            }
      })

      return Event.End({ reported: Option.none() })
    }),
  )

// The answer running here: each of its steps, then how it ended or failed.
// It lists the conversation in this browser's sidebar when asked here.
const answering =
  (client: QueryClient) =>
  ({ pending }: Running, id: ConversationId) =>
    marked(client, { id, pending }, (done) => {
      let steps: ReadonlyArray<Step> = []

      if (pending.via === "ask") record(id, pending.question)

      const ended = Effect.suspend(() =>
        Option.match(Option.filter(Option.fromNullishOr(steps.at(-1)), isEnding), {
          onNone: () => refresh(client, id).pipe(Effect.map((reported) => Event.End({ reported }))),
          onSome: (answer) => keep(client, { id, pending, steps, answer }),
        }),
      )

      const failed = (error: QuestionError) =>
        Effect.all([Clock.currentTimeMillis, refresh(client, id)]).pipe(
          Effect.map(([now, reported]) =>
            Event.Fail({
              error,
              retryAt: now + (error instanceof TooManyQuestions ? 60_000 : 0),
              reported,
            }),
          ),
        )

      // How the answer ended, once the page is done with it.
      const last = (event: Effect.Effect<Event>) =>
        Stream.fromEffect(Effect.tap(event, () => Effect.sync(done)))

      return stepsOf(id, pending).pipe(
        Stream.map((step) => {
          steps = put(steps, step)

          return Event.Progress({ step })
        }),
        Stream.concat(last(ended)),
        Stream.catch((error) => last(failed(error))),
        // The server died giving the answer and sent its defect down the
        // stream: the page shows the assistant as unavailable.
        Stream.catchDefect(() => last(failed(new AgentUnavailable()))),
      )
    })

// The answer of one conversation. A question is asked, retried or followed
// only while none is answered, and a stop is sent once per answer: the
// answer's own stream then ends with Stopped, which joins the turns like any
// ending. The page sends the stop for the answer the output names, and a
// stop that fails can be sent again.
const answer = (client: QueryClient) =>
  Machine.make<Answer, Event, Pending>()({
    initial: () => Answer.Idle({ failures: [] }),
    on: {
      Idle: {
        Ask: (state, { question, before, started }) =>
          start(state.failures, { question, via: "ask", before, started }),
        Retry: (state, { failure, before, started }) =>
          start(
            state.failures.filter((each) => each !== failure),
            { question: failure.question, via: "ask", before, started },
          ),
        Report: (state, { pending }) => start(state.failures, pending),
        ignore: ["Progress", "End", "Fail", "Stop", "StopFail"],
      },
      Running: {
        Progress: (state, { step }) => Answer.Running({ ...state, steps: put(state.steps, step) }),
        End: (state, { reported }) => settle(state.failures, reported),
        Fail: (state, { error, retryAt, reported }) =>
          settle(
            [
              ...state.failures,
              {
                question: state.pending.question,
                steps: state.steps,
                error,
                before: state.pending.before,
                retryAt,
              },
            ],
            reported,
          ),
        Stop: (state) =>
          Stop.$is("Sent")(state.stop)
            ? state
            : Machine.emit(Answer.Running({ ...state, stop: Stop.Sent() }), state.pending),
        StopFail: (state, { pending }) =>
          Stop.$is("Sent")(state.stop) && Equal.equals(state.pending, pending)
            ? Answer.Running({ ...state, stop: Stop.Failed() })
            : state,
        ignore: ["Ask", "Retry", "Report"],
      },
    },
    work: {
      // One answer keeps its work running while its steps come.
      Running: {
        key: ({ pending: { via, started } }) => `${via} ${started}`,
        run: answering(client),
      },
    },
  })

// Pending while this page asks a question or follows an answer.
export const answerKey = (id: ConversationId) => ["conversation", id, "answer"]

// One conversation: its turns, the answer in progress with its steps so far,
// each as it last was, and how to ask the next question. A finished answer
// joins the turns. The server finishes an answer even when the page leaves,
// so the page follows one it finds in progress, and asks the server again
// when an answer is cut off. Everything here belongs to `id`: another
// conversation starts with none of it, and stops this one's work.
export const useConversation = (id: ConversationId) => {
  const queryClient = useQueryClient()
  const conversation = useQuery(turnsQuery(id))
  // A conversation the server does not have has no turns, even ones this
  // browser saved before the server deleted it. A new one has none either.
  const missing = conversation.error instanceof ConversationNotFound
  const found = missing ? undefined : conversation.data
  const machine = useMemo(() => answer(queryClient), [queryClient])

  const [state, send] = useMachine(machine, {
    input: id,
    // Asks the server to stop the answer in progress.
    on: (pending) =>
      Effect.runFork(
        request(page, (api) => api.conversation.stop({ params: { id } })).pipe(
          Effect.catch(() => Effect.sync(() => send(Event.StopFail({ pending })))),
        ),
      ),
  })

  const answered = found?.answered.length ?? 0

  // Follows an answer the server reports, unless one is answered here.
  useEffect(() => {
    if (found === undefined) return

    const reported = following(found)

    if (Option.isSome(reported)) send(Event.Report({ pending: reported.value }))
  }, [found, send])

  const ask = (question: string) =>
    send(Event.Ask({ question, before: answered, started: Date.now() }))

  // The question being answered, whether it was asked here or followed,
  // when it started, what the agent did, and whether it can be stopped. An
  // answer whose turn is saved is over, even before the machine hears it
  // ended.
  const pending = Answer.$match(state, {
    Idle: () => undefined,
    Running: ({ pending: { question, via, started, before }, steps, stop }) =>
      found?.answered[before]?.question === question
        ? undefined
        : { question, via, started, steps, stop },
  })

  const failed = withLost(state.failures, { lost: found?.lost, before: answered })

  return {
    turns: found?.answered ?? none,
    // Why the turns could not be read.
    error: missing ? null : conversation.error,
    failures: failed.filter(
      (failure) =>
        found?.answered[failure.before]?.question !== failure.question &&
        pending?.question !== failure.question,
    ),
    retry: (failure: Failure) => {
      if (Date.now() < failure.retryAt) return
      send(Event.Retry({ failure, before: answered, started: Date.now() }))
    },
    pending,
    stop: () => send(Event.Stop()),
    ask,
  }
}

// The turn showing `view` in place of its chart at `chart`: changed to it, or
// back when it is the agent's chart there. A turn changed back at every place
// keeps no changes.
const showing = (turn: Turn, { chart, view }: { chart: ChartIndex; view: View }): Turn => {
  const charts = chartsOf(turn.answer)

  const shown = charts.map((agent, place) =>
    place === chart
      ? toQuery(agent.view) === toQuery(view)
        ? null
        : view
      : (turn.shown?.[place] ?? null),
  )

  return withShown(turn, shown)
}

// The loaded conversation with the turn at `turn` as the server now keeps it.
const saved = (
  client: QueryClient,
  { id, turn }: { id: ConversationId; turn: TurnIndex },
  change: (turn: Turn) => Turn,
) =>
  client.setQueryData(turnsQuery(id).queryKey, (previous?: Turns) =>
    previous === undefined
      ? previous
      : Struct.evolve(previous, {
          answered: (answered) =>
            answered.map((each, index) => (index === turn ? change(each) : each)),
        }),
  )

// Keeps the chart a person changed one of a turn's charts to, one save at a
// time and in order. While a save runs, `variables` holds the chart to show;
// once the server keeps it, the saved conversation shows it too. Rejects with
// TurnNotFound, NoChart or AgentUnavailable, and the chart stays as it was.
export const useShow = (
  id: ConversationId,
  { turn, chart }: { turn: TurnIndex; chart: ChartIndex },
) => {
  const queryClient = useQueryClient()

  return useMutation({
    scope: { id: `conversation-${id}-turn-${turn}-chart-${chart}` },
    mutationFn: (view: View) =>
      call(page, (api) => api.conversation.show({ params: { id, turn, chart }, payload: view })),
    onSuccess: (_, view) =>
      saved(queryClient, { id, turn }, (each) => showing(each, { chart, view })),
  })
}

// Keeps what the person thought of a turn's answer, one vote at a time and in
// order. While a vote is sent, `variables` holds it; once the server keeps
// it, the saved conversation shows it too. Rejects with TurnNotFound or
// AgentUnavailable, and the vote stays as it was.
export const useVote = (id: ConversationId, turn: TurnIndex) => {
  const queryClient = useQueryClient()

  return useMutation({
    scope: { id: `conversation-${id}-turn-${turn}-vote` },
    mutationFn: (vote: Vote) =>
      call(page, (api) => api.conversation.vote({ params: { id, turn }, payload: vote })),
    onSuccess: (_, vote) => saved(queryClient, { id, turn }, Struct.assign({ vote })),
  })
}

// Counts what the person did with a turn's charts. Nothing shows whether the
// count arrived: it changes nothing the person sees.
export const useAct = (id: ConversationId, turn: TurnIndex) =>
  useMutation({
    mutationFn: (action: Action) =>
      call(page, (api) => api.conversation.act({ params: { id, turn }, payload: { action } })),
  })

declare module "@tanstack/react-router" {
  interface HistoryState {
    // A question to ask once the conversation page opens.
    readonly question?: string
  }
}
