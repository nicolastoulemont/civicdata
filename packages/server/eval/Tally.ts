import { Source } from "@civicdata/domain"
import { Console, Context, Effect, Layer, Option, Ref, Schema } from "effect"

// How each source answered the run: from a recording, or by a request that
// left the machine. A request the pacer refused counts as neither.
interface Count {
  readonly replayed: number
  readonly sent: number
}

// The tokens OpenAI billed a case for, retries included. Cached input is
// part of input, billed at a lower rate.
interface Tokens {
  input: number
  cached: number
  output: number
}

interface Interface {
  readonly replayed: (source: Source) => Effect.Effect<void>
  readonly sent: (source: Source) => Effect.Effect<void>
  // A fetch that adds the tokens of each OpenAI answer to the case named.
  readonly meter: (name: string) => Effect.Effect<typeof globalThis.fetch>
}

const none: Count = { replayed: 0, sent: 0 }

// The usage OpenAI's Responses API reports on each answer.
const Usage = Schema.Struct({
  usage: Schema.Struct({
    input_tokens: Schema.Int,
    output_tokens: Schema.Int,
    input_tokens_details: Schema.optionalKey(Schema.Struct({ cached_tokens: Schema.Int })),
  }),
})

const usageOf = Schema.decodeUnknownOption(Schema.fromJsonString(Usage))

const openai = "api.openai.com"

const sum = (all: Iterable<Tokens>) =>
  Array.from(all).reduce(
    (total, tokens) => ({
      input: total.input + tokens.input,
      cached: total.cached + tokens.cached,
      output: total.output + tokens.output,
    }),
    { input: 0, cached: 0, output: 0 },
  )

const format = ({ input, cached, output }: Tokens) =>
  `${input.toLocaleString("en")} input (${cached.toLocaleString("en")} cached), ${output.toLocaleString("en")} output`

// What a run of the eval asked of each source, and the OpenAI tokens each
// case used, printed when the run ends. Other evals on this machine share
// the sources' limits but not this count.
export class Tally extends Context.Service<Tally, Interface>()("@civicdata/server/eval/Tally") {
  static readonly layer = Layer.effect(
    Tally,
    Effect.gen(function* () {
      const counts = yield* Ref.make(new Map<Source, Count>())
      // Filled from inside fetch, outside any fiber.
      const bills = new Map<string, Tokens>()

      const add = (source: Source, field: keyof Count) =>
        Ref.update(counts, (all) => {
          const count = all.get(source) ?? none

          return new Map(all).set(source, { ...count, [field]: count[field] + 1 })
        })

      const report = (all: ReadonlyMap<Source, Count>) => {
        const expensive = Array.from(bills)
          .toSorted(([, a], [, b]) => b.input + b.output - (a.input + a.output))
          .slice(0, 5)

        return [
          "Source requests (sent / replayed):",
          ...Source.literals.map((source) => {
            const { sent, replayed } = all.get(source) ?? none

            return `  ${source}: ${sent} / ${replayed}`
          }),
          `OpenAI tokens: ${format(sum(bills.values()))}`,
          "Most expensive cases, by input and output tokens:",
          ...expensive.map(([name, tokens]) => `  ${format(tokens)}: ${name}`),
        ].join("\n")
      }

      yield* Effect.addFinalizer(() =>
        Ref.get(counts).pipe(Effect.flatMap((all) => Console.log(report(all)))),
      )

      return Tally.of({
        replayed: (source) => add(source, "replayed"),
        sent: (source) => add(source, "sent"),
        meter: (name) =>
          Effect.sync(() => {
            const tokens = bills.get(name) ?? { input: 0, cached: 0, output: 0 }

            bills.set(name, tokens)

            return async (input: RequestInfo | URL, init?: RequestInit) => {
              const response = await fetch(input, init)
              const url = new URL(input instanceof Request ? input.url : input)

              if (url.host !== openai) return response

              const answer = usageOf(await response.clone().text())

              if (Option.isSome(answer)) {
                const { usage } = answer.value

                tokens.input += usage.input_tokens
                tokens.cached += usage.input_tokens_details?.cached_tokens ?? 0
                tokens.output += usage.output_tokens
              }

              return response
            }
          }),
      })
    }),
  )
}
