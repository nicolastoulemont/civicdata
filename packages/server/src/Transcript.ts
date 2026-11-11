import { ChartIndex, chartsOf, Turn, TurnIndex, View } from "@civicdata/domain"
import {
  Array as Arr,
  Clock,
  Context,
  type DateTime,
  Effect,
  Layer,
  Option,
  Ref,
  Schema,
  Struct,
} from "effect"

// A chart a person changed since the model last heard of it: its turn, its
// place among the turn's charts, and the chart the model knows there.
const Edit = Schema.Struct({ turn: TurnIndex, chart: ChartIndex, known: View })

export interface Edit extends Schema.Schema.Type<typeof Edit> {}

// What a conversation keeps: the model's chat history as Effect AI exports it,
// the turns shown to people, the charts a person changed since the model last
// heard of them, in the order they changed, and the question being answered,
// if any.
export interface Saved {
  readonly chat: string
  readonly turns: ReadonlyArray<Turn>
  readonly edits?: Arr.NonEmptyReadonlyArray<Edit>
  readonly answering?: { readonly question: string; readonly started: DateTime.Utc }
}

// The writes a save makes in one storage transaction.
export interface Writes {
  readonly put: (key: string, value: string) => Promise<void>
  readonly setAlarm: (time: number) => Promise<void>
}

// The part of a Durable Object's storage a transcript uses. A transaction
// commits all its writes or, when its closure rejects, none of them.
export interface Storage {
  readonly get: (key: string) => Promise<string | undefined>
  readonly put: (key: string, value: string) => Promise<void>
  readonly getAlarm: () => Promise<number | null>
  readonly transaction: (closure: (txn: Writes) => Promise<void>) => Promise<void>
  readonly deleteAll: () => Promise<void>
}

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
