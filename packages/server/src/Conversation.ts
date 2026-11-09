import {
  type AgentUnavailable,
  type CatalogUnavailable,
  ConversationBusy,
  Ending,
  type SourceUnavailable,
  type Step,
  type Turns,
} from "@civicdata/domain"
import {
  Context,
  Effect,
  Layer,
  Option,
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
}

// The step that ends an answer, and is kept in its turn.
const isEnding = Schema.is(Ending)

// Steps kept for whoever follows an answer late: more than an answer has.
const replay = 256

// The question being answered, and its steps so far for whoever follows it.
interface Answer {
  readonly question: string
  readonly steps: PubSub.PubSub<Take.Take<Step, Failure>>
}

// One conversation: its turns, and follow-up questions answered with the
// chat so far. An answer runs to its end even when nobody reads it any more,
// and its turn is saved then; an answer that fails leaves the conversation as
// it was.
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
      // Held to save a turn and to read the turns, so a reader never sees a
      // question both answered and still being answered.
      const lock = yield* Semaphore.make(1)

      const turns = Effect.gen(function* () {
        const saved = yield* transcript.load
        const answer = yield* Ref.get(current)

        return {
          answered: Option.match(saved, { onNone: () => [], onSome: (found) => found.turns }),
          ...Option.match(answer, {
            onNone: () => ({}),
            onSome: ({ question }) => ({ answering: question }),
          }),
        }
      }).pipe(Semaphore.withPermit(lock))

      const done = (steps: Answer["steps"]) =>
        Ref.update(
          current,
          Option.filter((answer) => answer.steps !== steps),
        )

      // Answers to the end, saving the turn before its last step goes out.
      const answer = Effect.fn("Conversation.answer")(
        function* ({ question, steps }: Answer) {
          const saved = yield* transcript.load

          const chat = Option.isNone(saved)
            ? yield* agent.start
            : yield* Chat.fromJson(saved.value.chat).pipe(Effect.orDie)

          const before = Option.match(saved, { onNone: () => [], onSome: (found) => found.turns })

          const save = (ending: Ending) =>
            chat.exportJson.pipe(
              Effect.orDie,
              Effect.flatMap((json) =>
                transcript.save({ chat: json, turns: [...before, { question, answer: ending }] }),
              ),
              Effect.andThen(done(steps)),
              Semaphore.withPermit(lock),
            )

          yield* agent.ask(chat, question).pipe(
            Stream.tap((step) => (isEnding(step) ? save(step) : Effect.void)),
            Stream.runForEachArray((chunk) => PubSub.publish(steps, chunk)),
          )
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

        const started = yield* Ref.modify(current, (answering) =>
          Option.isSome(answering) ? [false, answering] : [true, Option.some({ question, steps })],
        )

        if (!started) return yield* new ConversationBusy()

        yield* Effect.forkIn(answer({ question, steps }), scope)

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

      return Conversation.of({ turns, ask, follow })
    }),
  )
}
