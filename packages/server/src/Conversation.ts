import {
  type AgentUnavailable,
  type CatalogUnavailable,
  ConversationBusy,
  Ending,
  type SourceUnavailable,
  type Step,
  type Turn,
} from "@civicdata/domain"
import { Context, Effect, Layer, Option, Ref, Schema, Stream } from "effect"
import { Chat } from "effect/ai"

import { Agent } from "./Agent.ts"
import { Transcript } from "./Transcript.ts"

interface Interface {
  readonly turns: Effect.Effect<ReadonlyArray<Turn>>
  // The answer's steps. Fails with ConversationBusy while an earlier question
  // is still being answered.
  readonly ask: (
    question: string,
  ) => Effect.Effect<
    Stream.Stream<Step, AgentUnavailable | SourceUnavailable | CatalogUnavailable>,
    ConversationBusy
  >
}

// The step that ends an answer, and is kept in its turn.
const isEnding = Schema.is(Ending)

// One conversation: its turns, and follow-up questions answered with the
// whole chat so far. A turn is saved once its answer ends; an answer that
// fails or is cut off leaves the conversation as it was.
export class Conversation extends Context.Service<Conversation, Interface>()(
  "@civicdata/server/Conversation",
) {
  // Needs an Agent and a Transcript.
  static readonly layer = Layer.effect(
    Conversation,
    Effect.gen(function* () {
      const agent = yield* Agent
      const transcript = yield* Transcript
      const answering = yield* Ref.make(false)

      const turns = transcript.load.pipe(
        Effect.map(Option.match({ onNone: () => [], onSome: (saved) => saved.turns })),
      )

      const ask = Effect.fn("Conversation.ask")(function* (question: string) {
        if (yield* Ref.getAndSet(answering, true)) return yield* new ConversationBusy()

        // Everything before the stream starts. A defect here must not leave
        // the conversation marked busy.
        const { chat, before } = yield* Effect.gen(function* () {
          const saved = yield* transcript.load

          return Option.isNone(saved)
            ? { chat: yield* agent.start, before: [] }
            : {
                chat: yield* Chat.fromJson(saved.value.chat).pipe(Effect.orDie),
                before: saved.value.turns,
              }
        }).pipe(Effect.onError(() => Ref.set(answering, false)))

        const save = (answer: Ending) =>
          chat.exportJson.pipe(
            Effect.orDie,
            Effect.flatMap((json) =>
              transcript.save({ chat: json, turns: [...before, { question, answer }] }),
            ),
          )

        return agent.ask(chat, question).pipe(
          Stream.tap((step) => (isEnding(step) ? save(step) : Effect.void)),
          Stream.ensuring(Ref.set(answering, false)),
        )
      })

      return Conversation.of({ turns, ask })
    }),
  )
}
