import { Source } from "@civicdata/domain"
import { Console, Context, Effect, Layer, Ref } from "effect"

// How each source answered the run: from a recording, or by a request that
// left the machine. A request the pacer refused counts as neither.
interface Count {
  readonly replayed: number
  readonly sent: number
}

interface Interface {
  readonly replayed: (source: Source) => Effect.Effect<void>
  readonly sent: (source: Source) => Effect.Effect<void>
}

const none: Count = { replayed: 0, sent: 0 }

// What a run of the eval asked of each source, printed when the run ends.
// Other evals on this machine share the sources' limits but not this count.
export class Tally extends Context.Service<Tally, Interface>()("@civicdata/server/eval/Tally") {
  static readonly layer = Layer.effect(
    Tally,
    Effect.gen(function* () {
      const counts = yield* Ref.make(new Map<Source, Count>())

      const add = (source: Source, field: keyof Count) =>
        Ref.update(counts, (all) => {
          const count = all.get(source) ?? none

          return new Map(all).set(source, { ...count, [field]: count[field] + 1 })
        })

      yield* Effect.addFinalizer(() =>
        Ref.get(counts).pipe(
          Effect.flatMap((all) =>
            Console.log(
              [
                "Source requests (sent / replayed):",
                ...Source.literals.map((source) => {
                  const { sent, replayed } = all.get(source) ?? none

                  return `  ${source}: ${sent} / ${replayed}`
                }),
              ].join("\n"),
            ),
          ),
        ),
      )

      return Tally.of({
        replayed: (source) => add(source, "replayed"),
        sent: (source) => add(source, "sent"),
      })
    }),
  )
}
