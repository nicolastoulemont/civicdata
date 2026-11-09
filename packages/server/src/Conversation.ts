import {
  type AgentUnavailable,
  type CatalogUnavailable,
  ConversationBusy,
  Ended,
  Ending,
  put,
  type SourceUnavailable,
  type Step,
  Stopped,
  type Turns,
  type Work,
} from "@civicdata/domain"
import {
  Array as Arr,
  Context,
  DateTime,
  Deferred,
  Effect,
  Layer,
  Option,
  Predicate,
  PubSub,
  Ref,
  Schema,
  Semaphore,
  Stream,
  type Take,
} from "effect"
import { Chat } from "effect/ai"

import { Agent } from "./Agent.ts"
import { Transcript } from "./Transcript.ts"

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
}

// The step that ends an answer, and is kept in its turn.
const isEnding = Schema.is(Ending)

// The steps of work a turn keeps: those that ended.
const isEnded = Schema.is(Ended)

// A step still running when the answer stopped, as stopped.
const halted = (step: Work): ReadonlyArray<Work> =>
  Predicate.isTagged(step.state, "Running") ? [{ ...step, state: Stopped.make({}) }] : []

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
      const current = yield* Ref.make(Option.none<Answer>())
      // Held to save a turn, to read the turns and to stop an answer, so a
      // reader never sees a question both answered and still being answered,
      // and an answer is kept either as it ended or as stopped, never both.
      const lock = yield* Semaphore.make(1)

      const turns = Effect.gen(function* () {
        const saved = yield* transcript.load
        const answer = yield* Ref.get(current)

        return {
          answered: Option.match(saved, { onNone: () => [], onSome: (found) => found.turns }),
          ...Option.match(answer, {
            onNone: () => ({}),
            onSome: ({ question, started }) => ({ answering: { question, started } }),
          }),
        }
      }).pipe(Semaphore.withPermit(lock))

      const done = (steps: Answer["steps"]) =>
        Ref.update(
          current,
          Option.filter((answer) => answer.steps !== steps),
        )

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

          const before = Option.match(saved, { onNone: () => [], onSome: (found) => found.turns })

          const asked = yield* chat.exportJson.pipe(Effect.orDie)

          // A turn keeps the steps the agent ended and how long it took,
          // stopped or not.
          const save = Effect.fnUntraced(function* (ending: Ending, json: string) {
            const took = DateTime.distance(started, yield* DateTime.now)
            const kept = (yield* Ref.get(work)).filter(isEnded)

            yield* transcript.save({
              chat: json,
              turns: [...before, { question, answer: ending, steps: kept, took }],
            })
            yield* done(steps)
          })

          // Nothing is kept or sent once a stop arrives. Stops are only
          // asked for under the lock, so a stop and an ending never both win.
          const end = (ending: Ending) =>
            Effect.gen(function* () {
              if (yield* Deferred.isDone(stop)) return

              yield* save(ending, yield* chat.exportJson.pipe(Effect.orDie))
            }).pipe(Semaphore.withPermit(lock))

          yield* agent.ask(chat, question).pipe(
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
            yield* save(Stopped.make({}), asked).pipe(Semaphore.withPermit(lock))
            yield* PubSub.publish(steps, Arr.append(cut, Stopped.make({})))
          }
        },
        (effect, { steps }) =>
          effect.pipe(
            Effect.onExit((exit) => PubSub.end(steps, exit)),
            Effect.ensuring(done(steps)),
            // Whoever follows the answer receives its failure.
            Effect.ignore,
          ),
      )

      const ask = Effect.fn("Conversation.ask")(function* (question: string) {
        const steps = yield* PubSub.unbounded<Take.Take<Step, Failure>>({ replay })

        const stop = yield* Deferred.make<void>()
        const started = yield* DateTime.now
        const next = { question, started, steps, stop }

        const free = yield* Ref.modify(current, (answering) =>
          Option.isSome(answering) ? [false, answering] : [true, Option.some(next)],
        )

        if (!free) return yield* new ConversationBusy()

        yield* Effect.forkIn(answer(next), scope)

        return Stream.fromPubSubTake(steps)
      })

      const follow = Ref.get(current).pipe(
        Effect.map(
          Option.match({
            onNone: () => Stream.empty,
            onSome: ({ steps }) => Stream.fromPubSubTake(steps),
          }),
        ),
      )

      // Asks the answer in progress to stop, then waits for its last step.
      // An answer that failed meanwhile has nothing to keep.
      const stop = Effect.gen(function* () {
        const stopped = yield* Ref.get(current).pipe(
          Effect.tap(
            Option.match({
              onNone: () => Effect.void,
              onSome: (running) => Deferred.succeed(running.stop, undefined),
            }),
          ),
          Semaphore.withPermit(lock),
        )

        if (Option.isSome(stopped)) {
          yield* Stream.runDrain(Stream.fromPubSubTake(stopped.value.steps)).pipe(Effect.ignore)
        }
      }).pipe(Effect.withSpan("Conversation.stop"))

      return Conversation.of({ turns, ask, follow, stop })
    }),
  )
}
