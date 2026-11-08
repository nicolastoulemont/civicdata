import {
  AgentUnavailable,
  Api,
  IndicatorId,
  IndicatorNotFound,
  NoChart,
  TooManyQuestions,
  Trend,
  Year,
} from "@civicdata/domain"
import { describe, expect, it } from "@effect/vitest"
import { DateTime, Effect, Layer, Stream } from "effect"
import { AiError, LanguageModel, type Response } from "effect/ai"
import { HttpServer } from "effect/http"
import { HttpApiTest } from "effect/http-api"

import { Agent } from "../src/Agent.ts"
import { AskLimit } from "../src/AskLimit.ts"
import { Catalog } from "../src/Catalog.ts"
import { Handlers } from "../src/Handlers.ts"
import { Resolver } from "../src/Resolver.ts"
import { WorldBank } from "../src/WorldBank.ts"

const lifeExpectancy = IndicatorId.make("SP.DYN.LE00.IN")

// A World Bank that publishes life expectancy for Brazil, 2000 to 2002.
const worldBank = Layer.succeed(
  WorldBank,
  WorldBank.of({
    describe: (indicator) =>
      indicator === lifeExpectancy
        ? Effect.succeed({
            indicator: {
              id: indicator,
              name: "Life expectancy at birth, total (years)",
              definition: "",
            },
            dataset: "World Development Indicators",
            retrievedAt: DateTime.makeUnsafe("2026-11-01T00:00:00Z"),
          })
        : Effect.fail(new IndicatorNotFound({ indicator })),
    observations: (query) =>
      Effect.succeed({
        observations: [2000, 2001, 2002].flatMap((year) =>
          query.countries.includes("BRA") && year >= query.from && year <= query.to
            ? [{ country: "BRA" as const, year: Year.make(year), value: 70 + year - 2000 }]
            : [],
        ),
        url: `https://api.worldbank.org/v2/indicator/${query.indicator}`,
        retrievedAt: DateTime.makeUnsafe("2026-11-01T00:00:00Z"),
      }),
    indicators: Effect.succeed([]),
  }),
)

const catalog = Layer.succeed(
  Catalog,
  Catalog.of({
    search: () =>
      Effect.succeed([
        {
          indicator: lifeExpectancy,
          name: "Life expectancy at birth, total (years)",
          definition: "",
        },
      ]),
  }),
)

const finish: Response.PartEncoded = {
  type: "finish",
  reason: "tool-calls",
  usage: { inputTokens: {}, outputTokens: {} },
}

// A tool's arguments as the model sends them: JSON values.
type Arguments = Readonly<Record<string, string | number | null | ReadonlyArray<string>>>

const call = (
  name: "search_indicators" | "show_chart",
  params: Arguments,
): ReadonlyArray<Response.PartEncoded> => [
  { type: "tool-call", id: `call-${name}`, name, params },
  finish,
]

const brazil = {
  chart: "trend",
  indicator: lifeExpectancy,
  countries: ["BRA"],
  from: 2000,
  to: 2002,
  year: null,
  transform: null,
}

const done: ReadonlyArray<Response.PartEncoded> = [{ type: "text", text: "Done." }, finish]

// A model that answers each turn from a script, in order. Past the script it
// answers in words.
const scripted = (
  turns: ReadonlyArray<Effect.Effect<ReadonlyArray<Response.PartEncoded>, AiError.AiError>>,
) => {
  let turn = 0

  return Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: () => {
        const next = turns[turn] ?? Effect.succeed(done)

        turn += 1

        return Effect.map(next, (parts) => [...parts])
      },
      streamText: () => Stream.die("the agent does not stream"),
    }),
  )
}

const serve = (model: Layer.Layer<LanguageModel.LanguageModel>, limit = AskLimit.none) =>
  Layer.mergeAll(
    Handlers.pipe(
      Layer.provide(Agent.layer.pipe(Layer.provide(model), Layer.provide(Resolver.layer))),
      Layer.provide(limit),
      Layer.provide(catalog),
      Layer.provide(worldBank),
    ),
    HttpServer.layerServices,
  )

const ask = (question: string) =>
  Effect.flatMap(HttpApiTest.groups(Api, ["agent"]), (client) =>
    client.agent.ask({ payload: { question } }),
  )

describe("POST /api/agent/ask", () => {
  it.effect("answers with the chart the model shows, once it resolves to data", () =>
    Effect.gen(function* () {
      expect(yield* ask("How has life expectancy changed in Brazil?")).toEqual(
        Trend.make({
          indicator: lifeExpectancy,
          countries: ["BRA"],
          from: Year.make(2000),
          to: Year.make(2002),
        }),
      )
    }).pipe(
      Effect.provide(
        serve(
          scripted([
            Effect.succeed(call("search_indicators", { text: "life expectancy" })),
            Effect.succeed(call("show_chart", brazil)),
          ]),
        ),
      ),
    ),
  )

  it.effect("gives a rejected chart back to the model to fix", () =>
    Effect.gen(function* () {
      const view = yield* ask("Life expectancy in Brazil")

      expect(view.countries).toEqual(["BRA"])
    }).pipe(
      Effect.provide(
        serve(
          scripted([
            // An aggregate instead of a country, then years with no data.
            Effect.succeed(call("show_chart", { ...brazil, countries: ["LCN"] })),
            Effect.succeed(call("show_chart", { ...brazil, from: 1960, to: 1961 })),
            Effect.succeed(call("show_chart", brazil)),
          ]),
        ),
      ),
    ),
  )

  it.effect("fails with NoChart when the model answers in words", () =>
    Effect.gen(function* () {
      const error = yield* ask("What is the meaning of life?").pipe(Effect.flip)

      expect(error).toBeInstanceOf(NoChart)
    }).pipe(
      Effect.provide(
        serve(
          scripted([
            Effect.succeed([
              { type: "text", text: "No World Bank indicator measures that." },
              finish,
            ]),
          ]),
        ),
      ),
    ),
  )

  it.effect("fails with TooManyQuestions before asking the model when over the limit", () =>
    Effect.gen(function* () {
      const error = yield* ask("Life expectancy in Brazil").pipe(Effect.flip)

      expect(error).toBeInstanceOf(TooManyQuestions)
    }).pipe(
      Effect.provide(
        serve(
          scripted([Effect.die("the model must not be asked")]),
          Layer.succeed(
            AskLimit,
            AskLimit.of({ count: () => Effect.fail(new TooManyQuestions()) }),
          ),
        ),
      ),
    ),
  )

  it.effect("fails with AgentUnavailable when the model fails", () =>
    Effect.gen(function* () {
      const error = yield* ask("Life expectancy in Brazil").pipe(Effect.flip)

      expect(error).toBeInstanceOf(AgentUnavailable)
    }).pipe(
      Effect.provide(
        serve(
          scripted([
            Effect.fail(
              new AiError.AiError({
                module: "OpenAI",
                method: "generateText",
                reason: new AiError.UnknownError({ description: "upstream 500" }),
              }),
            ),
          ]),
        ),
      ),
    ),
  )
})
