import {
  type AgentUnavailable,
  Answered,
  type Block,
  type CatalogUnavailable,
  ChartIndex,
  chartsOf,
  ConversationBusy,
  Ended,
  Ending,
  Halted,
  NoChart,
  put,
  Rendered,
  type SourceUnavailable,
  type Step,
  Stopped,
  type Turn,
  type TurnIndex,
  TurnNotFound,
  type Turns,
  type View,
  type Work,
} from "@civicdata/domain"
import { Machine } from "@civicdata/machine"
import {
  Array as Arr,
  Context,
  Data,
  DateTime,
  Deferred,
  Effect,
  Equal,
  Layer,
  Option,
  Predicate,
  PubSub,
  Ref,
  Schema,
  Semaphore,
  Stream,
  Struct,
  type Take,
} from "effect"
import { Chat } from "effect/ai"

import { Agent, type Changed } from "./Agent.ts"
import { type Saved, Transcript } from "./Transcript.ts"

// Why an answer stopped short.
type Failure = AgentUnavailable | SourceUnavailable | CatalogUnavailable

interface Interface {
  readonly turns: Effect.Effect<Turns>
  // Starts answering a question and streams its steps. Fails with
  // ConversationBusy while an earlier question is still being answered.
  readonly ask: (question: string) => Effect.Effect<Stream.Stream<Step, Failure>, ConversationBusy>
  // The answer in progress from its first step, or no steps when there is none.
  readonly follow: Effect.Effect<Stream.Stream<Step, Failure>>
  // Stops the answer in progress and keeps its turn as Stopped, returning
  // once it is kept. Does nothing when no answer is in progress.
  readonly stop: Effect.Effect<void>
  // Keeps the chart a person changed one of a turn's charts to, and builds
  // the next question on it. The agent's own chart changes it back. Fails
  // with TurnNotFound or, for a turn with no chart at that place, NoChart.
  readonly show: (
    turn: TurnIndex,
    options: { readonly chart: ChartIndex; readonly view: View },
  ) => Effect.Effect<void, TurnNotFound | NoChart>
  // Deletes the conversation once no answer is running: now, or when the
  // answer in progress fails. An answer that keeps its turn keeps the
  // conversation too, as saving it moves the alarm on, even when this alarm
  // was already on its way. Returns once the conversation is deleted, or at
  // once when an answer is running.
  readonly expire: Effect.Effect<void>
}

// The step that ends an answer, and is kept in its turn.
const isEnding = Schema.is(Ending)

// The steps of work a turn keeps: those that ended.
const isEnded = Schema.is(Ended)

const isStopped = Schema.is(Stopped)

const isRendered = Schema.is(Rendered)

// A step still running when the answer stopped, as stopped. A block has no
// state: it is sent once written.
const halted = (step: Work): ReadonlyArray<Work> =>
  !isRendered(step) && Predicate.isTagged(step.state, "Running")
    ? [{ ...step, state: Halted.make({}) }]
    : []

// The blocks the agent wrote before a stop, in order.
const writtenIn = (work: ReadonlyArray<Work>): ReadonlyArray<Block> =>
  work.flatMap((step) => (isRendered(step) ? [step.block] : []))

const isAnswered = Schema.is(Answered)

// The charts a turn shows, in order: the ones a person changed its charts
// to, else the agent's. A turn that ended with no charts shows none.
const onScreen = (turn: Turn): ReadonlyArray<View> =>
  chartsOf(turn.answer).map(({ view }, place) => turn.shown?.[place] ?? view)

// The turn showing `view` in place of its chart at `chart`: changed to it,
// or back when it is the agent's chart there. A turn changed back at every
// place keeps no changes. A turn with no chart there has none to change.
const showing = (turn: Turn, { chart, view }: Changed): Turn | undefined => {
  const charts = chartsOf(turn.answer)
  const agent = charts[chart]

  if (agent === undefined) return undefined

  const shown = charts.map((_, place) =>
    place === chart
      ? Equal.equals(view, agent.view)
        ? null
        : view
      : (turn.shown?.[place] ?? null),
  )

  return shown.every((each) => each === null)
    ? Struct.omit(turn, ["shown"])
    : Struct.assign(turn, { shown })
}

// The charts on screen that a person changed since the agent's last answer,
// each with its place: those of the turn changed last that are not the last
// answer's chart at that place. The next question builds on them.
const changedOf = ({ turns, changed }: Saved): ReadonlyArray<Changed> => {
  const shown = changed === undefined ? undefined : turns[changed]
  const last = turns.findLast((turn) => isAnswered(turn.answer))
  const answered = last === undefined ? [] : onScreen(Struct.omit(last, ["shown"]))

  return (shown === undefined ? [] : onScreen(shown)).flatMap((view, place) =>
    Equal.equals(view, answered[place]) ? [] : [{ chart: ChartIndex.make(place), view }],
  )
}

// Steps kept for whoever follows an answer late: more than an answer has.
const replay = 256

// The question being answered, when it was asked, its steps so far for
// whoever follows it, and whether someone asked to stop it.
interface Answer {
  readonly question: string
  readonly started: DateTime.Utc
  readonly steps: PubSub.PubSub<Take.Take<Step, Failure>>
  readonly stop: Deferred.Deferred<void>
}

// What a conversation is doing: nothing, answering a question, or deleting
// itself. `due` records that its time ran out while it was answering.
type Phase = Data.TaggedEnum<{
  Idle: {}
  Answering: Answer & { readonly due: boolean }
  Expiring: {}
}>

const Phase = Data.taggedEnum<Phase>()

// `Saved` comes as an answer keeps its turn, which moves the alarm on.
// `Finished` comes once an answer's fiber is over, whether or not it kept its
// turn; it names the answer, so it never ends a later one. `Expire` comes
// from the alarm.
type PhaseEvent = Data.TaggedEnum<{
  Ask: { readonly answer: Answer }
  Saved: {}
  Finished: { readonly steps: Answer["steps"] }
  Expire: {}
  Deleted: {}
}>

const PhaseEvent = Data.taggedEnum<PhaseEvent>()

// The alarm never deletes a conversation while it answers: an answer that
// started before the deletion would save its whole chat with only its own
// turn. It waits for the answer to end, and deletes the conversation then
// unless the answer kept its turn. A question asked while the conversation
// is being deleted is refused as busy.
const lifecycle = Machine.make<Phase, PhaseEvent>()({
  initial: () => Phase.Idle(),
  on: {
    Idle: {
      Ask: (_, { answer }) => Phase.Answering({ ...answer, due: false }),
      Expire: () => Phase.Expiring(),
      ignore: ["Saved", "Finished", "Deleted"],
    },
    Answering: {
      Saved: () => Phase.Idle(),
      Finished: (answering, { steps }) => {
        if (answering.steps !== steps) return answering

        return answering.due ? Phase.Expiring() : Phase.Idle()
      },
      Expire: (answering) => Phase.Answering({ ...answering, due: true }),
      ignore: ["Ask", "Deleted"],
    },
    Expiring: {
      Deleted: () => Phase.Idle(),
      ignore: ["Ask", "Saved", "Finished", "Expire"],
    },
  },
  work: {
    // Storage failures are defects. One is logged and ends the deletion, so
    // the conversation can answer again; the next save moves the alarm on.
    Expiring: () =>
      Transcript.use((transcript) => transcript.expire).pipe(
        Effect.catchDefect((defect) => Effect.logError("Conversation not deleted", defect)),
        Effect.as(PhaseEvent.Deleted()),
      ),
  },
})

const isAnswering = Phase.$is("Answering")

const isExpiring = Phase.$is("Expiring")

// One conversation: its turns, and follow-up questions answered with the
// chat so far. An answer runs to its end even when nobody reads it any more,
// and its turn is saved then; an answer that fails leaves the conversation as
// it was. Only `stop` ends an answer early.
export class Conversation extends Context.Service<Conversation, Interface>()(
  "@civicdata/server/Conversation",
) {
  // Needs an Agent and a Transcript.
  static readonly layer = Layer.effect(
    Conversation,
    Effect.gen(function* () {
      const agent = yield* Agent
      const transcript = yield* Transcript
      // Answers run in the conversation's scope, not the request's, so a
      // visitor leaving does not stop them.
      const scope = yield* Effect.scope
      const phase = yield* Machine.start(lifecycle)
      // Held to save a turn, to read the turns and to stop an answer, so a
      // reader never sees a question both answered and still being answered,
      // and an answer is kept either as it ended or as stopped, never both.
      const lock = yield* Semaphore.make(1)

      const turns = Effect.gen(function* () {
        const saved = yield* transcript.load
        const now = yield* phase.get

        const answered = Option.match(saved, { onNone: () => [], onSome: (found) => found.turns })

        return isAnswering(now)
          ? { answered, answering: { question: now.question, started: now.started } }
          : { answered }
      }).pipe(Semaphore.withPermit(lock))

      // Answers to the end, saving the turn before its last step goes out. A
      // stop cuts the agent off, so it makes no more model requests, and
      // keeps the turn as Stopped with the chat as it was before the
      // question: the agent never finished its answer, so the next question
      // does not build on it. The steps still running then end as stopped.
      const answer = Effect.fn("Conversation.answer")(
        function* ({ question, started, steps, stop }: Answer) {
          const saved = yield* transcript.load
          const work = yield* Ref.make<ReadonlyArray<Work>>([])

          const chat = Option.isNone(saved)
            ? yield* agent.start
            : yield* Chat.fromJson(saved.value.chat).pipe(Effect.orDie)

          const changed = Option.match(saved, { onNone: () => [], onSome: changedOf })

          const asked = yield* chat.exportJson.pipe(Effect.orDie)

          // A turn keeps the steps the agent ended and how long it took,
          // stopped or not. The turns are read again under the lock, as a
          // chart may have been changed meanwhile. A new chart makes earlier
          // changes old news. Otherwise a change stays for the next question
          // unless the model heard of it with this one: a stopped answer
          // leaves the chat as it was, and a change made while the agent
          // answered never reached it.
          const save = Effect.fnUntraced(function* (ending: Ending, json: string) {
            const took = DateTime.distance(started, yield* DateTime.now)
            const kept = (yield* Ref.get(work)).filter(isEnded)
            const latest = Option.getOrUndefined(yield* transcript.load)

            const heard =
              isAnswered(ending) ||
              (!isStopped(ending) &&
                Equal.equals(latest === undefined ? [] : changedOf(latest), changed))

            const unheard = heard ? undefined : latest?.changed

            const next: Saved = {
              chat: json,
              turns: [...(latest?.turns ?? []), { question, answer: ending, steps: kept, took }],
            }

            yield* transcript.save(unheard === undefined ? next : { ...next, changed: unheard })
            yield* phase.send(PhaseEvent.Saved())
          })

          // Nothing is kept or sent once a stop arrives. Stops are only
          // asked for under the lock, so a stop and an ending never both win.
          const end = (ending: Ending) =>
            Effect.gen(function* () {
              if (yield* Deferred.isDone(stop)) return

              yield* save(ending, yield* chat.exportJson.pipe(Effect.orDie))
            }).pipe(Semaphore.withPermit(lock))

          yield* agent.ask(chat, { question, changed }).pipe(
            Stream.tap((step) =>
              isEnding(step) ? end(step) : Ref.update(work, (previous) => put(previous, step)),
            ),
            Stream.interruptWhen(Deferred.await(stop)),
            Stream.runForEachArray((chunk) =>
              Effect.flatMap(Deferred.isDone(stop), (stopped) =>
                stopped ? Effect.void : PubSub.publish(steps, chunk),
              ),
            ),
          )

          if (yield* Deferred.isDone(stop)) {
            const cut = (yield* Ref.get(work)).flatMap(halted)

            yield* Ref.update(work, (previous) => cut.reduce(put, previous))

            const blocks = writtenIn(yield* Ref.get(work))

            const stopped = Arr.isReadonlyArrayNonEmpty(blocks)
              ? Stopped.make({ blocks })
              : Stopped.make({})

            yield* save(stopped, asked).pipe(Semaphore.withPermit(lock))
            yield* PubSub.publish(steps, Arr.append(cut, stopped))
          }
        },
        (effect, { steps }) =>
          effect.pipe(
            Effect.onExit((exit) => PubSub.end(steps, exit)),
            Effect.ensuring(phase.send(PhaseEvent.Finished({ steps }))),
            // Whoever follows the answer receives its failure.
            Effect.ignore,
          ),
      )

      const ask = Effect.fn("Conversation.ask")(function* (question: string) {
        const steps = yield* PubSub.unbounded<Take.Take<Step, Failure>>({ replay })

        const stop = yield* Deferred.make<void>()
        const started = yield* DateTime.now
        const next = { question, started, steps, stop }
        const now = yield* phase.send(PhaseEvent.Ask({ answer: next }))

        if (!isAnswering(now) || now.steps !== steps) return yield* new ConversationBusy()

        yield* Effect.forkIn(answer(next), scope)

        return Stream.fromPubSubTake(steps)
      })

      const follow = phase.get.pipe(
        Effect.map((now) => (isAnswering(now) ? Stream.fromPubSubTake(now.steps) : Stream.empty)),
      )

      // Asks the answer in progress to stop, then waits for its last step.
      // An answer that failed meanwhile has nothing to keep.
      const stop = Effect.gen(function* () {
        const now = yield* phase.get.pipe(
          Effect.tap((running) =>
            isAnswering(running) ? Deferred.succeed(running.stop, undefined) : Effect.void,
          ),
          Semaphore.withPermit(lock),
        )

        if (isAnswering(now)) {
          yield* Stream.runDrain(Stream.fromPubSubTake(now.steps)).pipe(Effect.ignore)
        }
      }).pipe(Effect.withSpan("Conversation.stop"))

      const show = Effect.fn("Conversation.show")(function* (turn: TurnIndex, change: Changed) {
        const saved = yield* transcript.load
        const found = Option.flatMap(saved, ({ turns: all }) => Arr.get(all, turn))

        if (Option.isNone(saved) || Option.isNone(found)) return yield* new TurnNotFound({ turn })

        const next = showing(found.value, change)

        if (next === undefined) return yield* new NoChart({ turn, chart: change.chart })

        return yield* transcript.save({
          ...saved.value,
          turns: saved.value.turns.with(turn, next),
          changed: turn,
        })
      }, Semaphore.withPermit(lock))

      // Waits out a deletion the alarm started. An answer running is not
      // waited for.
      const expire = phase
        .send(PhaseEvent.Expire())
        .pipe(
          Effect.andThen(
            phase.changes.pipe(Stream.filter(Predicate.not(isExpiring)), Stream.runHead),
          ),
          Effect.asVoid,
          Effect.withSpan("Conversation.expire"),
        )

      return Conversation.of({ turns, ask, follow, stop, show, expire })
    }),
  )
}
