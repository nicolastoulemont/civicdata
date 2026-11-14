import { ChartIndex, chartsOf, Turn, TurnIndex } from "@repo/domain"
import { Array as Arr, Clock, Context, Effect, Layer, Option, Ref, Schema, Struct } from "effect"

import { keep } from "./constants/keep.ts"
import { Edit } from "./Transcript.schemas.ts"
import type { Saved, Storage } from "./Transcript.types.ts"

interface Interface {
  readonly load: Effect.Effect<Option.Option<Saved>>
  readonly save: (saved: Saved) => Effect.Effect<void>
  // Drops the question being answered, leaving the alarm where it is: an
  // answer that kept no turn does not keep the conversation either.
  readonly forget: Effect.Effect<void>
  // Deletes the conversation once its time is up: a load after it finds
  // nothing. A save since the alarm fired moved the time on, and keeps it.
  readonly expire: Effect.Effect<void>
}

const Stored = Schema.fromJsonString(
  Schema.Struct({
    chat: Schema.String,
    turns: Schema.Array(Turn),
    edits: Schema.optionalKey(Schema.NonEmptyArray(Edit)),
    // Before edits, a transcript kept only the turn changed last.
    changed: Schema.optionalKey(TurnIndex),
    answering: Schema.optionalKey(
      Schema.Struct({ question: Schema.String, started: Schema.DateTimeUtcFromString }),
    ),
  }),
)

// A transcript as saved. One that kept only the turn changed last reads each
// chart that turn shows in place of the agent's as an edit the model has not
// heard of.
const savedOf = ({ changed, ...saved }: typeof Stored.Type): Saved => {
  const turn = changed === undefined ? undefined : saved.turns[changed]

  if (changed === undefined || turn === undefined) return saved

  const charts = chartsOf(turn.answer)

  const edits = (turn.shown ?? []).flatMap((view, place) => {
    const agent = charts[place]

    return view === null || agent === undefined
      ? []
      : [{ turn: changed, chart: ChartIndex.make(place), known: agent.view }]
  })

  return Arr.isReadonlyArrayNonEmpty(edits) ? { ...saved, edits } : saved
}

// Conversations saved before turns kept how their answer ended sit under
// "transcript"; they read as not found until their alarm deletes them.
const key = "conversation"

// One conversation's saved state.
export class Transcript extends Context.Service<Transcript, Interface>()(
  "@repo/server/Transcript",
) {
  static readonly memory = Layer.effect(
    Transcript,
    Effect.gen(function* () {
      const saved = yield* Ref.make(Option.none<Saved>())

      return Transcript.of({
        load: Ref.get(saved),
        save: (next) => Ref.set(saved, Option.some(next)),
        forget: Ref.update(saved, Option.map(Struct.omit(["answering"]))),
        expire: Ref.set(saved, Option.none()),
      })
    }),
  )

  // A Durable Object's storage. Each save moves the object's alarm to `keep`
  // from now in the same transaction, so a conversation is never kept without
  // an alarm to delete it. The object deletes everything when it fires, unless
  // a save set a later alarm after Cloudflare sent this one. The question
  // being answered is saved with the rest, so a restart that ends its answer
  // leaves a trace of it. Storage failures are defects: there is nothing a
  // caller can do about them.
  static readonly durable = (storage: Storage) => {
    const load = Effect.tryPromise(() => storage.get(key)).pipe(
      Effect.flatMap((json) =>
        json === undefined
          ? Effect.succeedNone
          : Schema.decodeEffect(Stored)(json).pipe(Effect.map(savedOf), Effect.asSome),
      ),
      Effect.orDie,
    )

    return Layer.succeed(
      Transcript,
      Transcript.of({
        load,
        save: Effect.fn("Transcript.save")(function* (saved: Saved) {
          const json = yield* Schema.encodeEffect(Stored)(saved)
          const now = yield* Clock.currentTimeMillis

          yield* Effect.tryPromise(() =>
            storage.transaction(async (txn) => {
              await txn.put(key, json)
              await txn.setAlarm(now + keep)
            }),
          )
        }, Effect.orDie),
        forget: Effect.gen(function* () {
          const saved = yield* load

          if (Option.isNone(saved) || saved.value.answering === undefined) return

          const json = yield* Schema.encodeEffect(Stored)(Struct.omit(saved.value, ["answering"]))

          yield* Effect.tryPromise(() => storage.put(key, json))
        }).pipe(Effect.orDie, Effect.withSpan("Transcript.forget")),
        expire: Effect.gen(function* () {
          const alarm = yield* Effect.tryPromise(() => storage.getAlarm())
          const now = yield* Clock.currentTimeMillis

          if (alarm !== null && alarm > now) return

          yield* Effect.tryPromise(() => storage.deleteAll())
        }).pipe(Effect.orDie, Effect.withSpan("Transcript.expire")),
      }),
    )
  }
}
