import { Turn, TurnIndex } from "@civicdata/domain"
import { Clock, Context, Effect, Layer, Option, Ref, Schema } from "effect"

// What a conversation keeps: the model's chat history as Effect AI exports it,
// the turns shown to people, and the turn whose chart a person changed last
// since the agent's last answer, if any.
export interface Saved {
  readonly chat: string
  readonly turns: ReadonlyArray<Turn>
  readonly changed?: TurnIndex
}

// The part of a Durable Object's storage a transcript uses.
export interface Storage {
  readonly get: (key: string) => Promise<string | undefined>
  readonly put: (key: string, value: string) => Promise<void>
  readonly setAlarm: (time: number) => Promise<void>
  readonly deleteAll: () => Promise<void>
}

interface Interface {
  readonly load: Effect.Effect<Option.Option<Saved>>
  readonly save: (saved: Saved) => Effect.Effect<void>
  // Deletes the conversation: a load after it finds nothing.
  readonly delete: Effect.Effect<void>
}

const Stored = Schema.fromJsonString(
  Schema.Struct({
    chat: Schema.String,
    turns: Schema.Array(Turn),
    changed: Schema.optionalKey(TurnIndex),
  }),
)

// Conversations saved before turns kept how their answer ended sit under
// "transcript"; they read as empty until their alarm deletes them.
const key = "conversation"

// A conversation is deleted this long after its last question.
export const keep = 30 * 24 * 60 * 60 * 1000

// One conversation's saved state.
export class Transcript extends Context.Service<Transcript, Interface>()(
  "@civicdata/server/Transcript",
) {
  static readonly memory = Layer.effect(
    Transcript,
    Effect.gen(function* () {
      const saved = yield* Ref.make(Option.none<Saved>())

      return Transcript.of({
        load: Ref.get(saved),
        save: (next) => Ref.set(saved, Option.some(next)),
        delete: Ref.set(saved, Option.none()),
      })
    }),
  )

  // A Durable Object's storage. Each save moves the object's alarm to `keep`
  // from now; the object deletes everything when it fires. Storage failures
  // are defects: there is nothing a caller can do about them.
  static readonly durable = (storage: Storage) =>
    Layer.succeed(
      Transcript,
      Transcript.of({
        load: Effect.tryPromise(() => storage.get(key)).pipe(
          Effect.flatMap((json) =>
            json === undefined
              ? Effect.succeedNone
              : Schema.decodeEffect(Stored)(json).pipe(Effect.asSome),
          ),
          Effect.orDie,
        ),
        save: Effect.fn("Transcript.save")(function* (saved: Saved) {
          const json = yield* Schema.encodeEffect(Stored)(saved)
          const now = yield* Clock.currentTimeMillis

          yield* Effect.tryPromise(() => storage.put(key, json))
          yield* Effect.tryPromise(() => storage.setAlarm(now + keep))
        }, Effect.orDie),
        delete: Effect.tryPromise(() => storage.deleteAll()).pipe(
          Effect.orDie,
          Effect.withSpan("Transcript.delete"),
        ),
      }),
    )
}
