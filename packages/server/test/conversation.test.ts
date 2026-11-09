import {
  AgentUnavailable,
  Answered,
  Api,
  Asked,
  Change,
  ConversationBusy,
  ConversationId,
  Described,
  IndicatorId,
  IndicatorNotFound,
  Located,
  Ranking,
  Rejected,
  Searched,
  TooManyQuestions,
  Trend,
  Unanswered,
  Year,
} from "@civicdata/domain"
import { describe, expect, it } from "@effect/vitest"
import { DateTime, Deferred, Effect, Fiber, Layer, Option, Schema, Stream } from "effect"
import { AiError, LanguageModel, type Response } from "effect/ai"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiTest } from "effect/http-api"

import { Agent } from "../src/Agent.ts"
import { AskLimit } from "../src/AskLimit.ts"
import { Catalog } from "../src/Catalog.ts"
import { serve } from "../src/ConversationObject.ts"
import { Conversations } from "../src/Conversations.ts"
import { Handlers } from "../src/Handlers.ts"
import { Resolver } from "../src/Resolver.ts"
import { Transcript } from "../src/Transcript.ts"
import { WorldBank } from "../src/WorldBank.ts"

const lifeExpectancy = IndicatorId.make("SP.DYN.LE00.IN")

const id = ConversationId.make("0b5d7c1e-8f4a-4c2b-9d3e-1a2b3c4d5e6f")

// A World Bank that publishes life expectancy for Brazil and Mexico, 2000 to 2002.
const worldBank = Layer.succeed(
  WorldBank,
  WorldBank.of({
    describe: (indicator) =>
      indicator === lifeExpectancy
        ? Effect.succeed({
            indicator: {
              id: indicator,
              name: "Life expectancy at birth, total (years)",
              definition: "The number of years a newborn infant would live.",
            },
            dataset: "World Development Indicators",
            retrievedAt: DateTime.makeUnsafe("2026-11-01T00:00:00Z"),
          })
        : Effect.fail(new IndicatorNotFound({ indicator })),
    observations: (query) =>
      Effect.succeed({
        observations: (["BRA", "MEX"] as const).flatMap((country) =>
          [2000, 2001, 2002].flatMap((year) =>
            query.countries.includes(country) && year >= query.from && year <= query.to
              ? [{ country, year: Year.make(year), value: 70 + year - 2000 }]
              : [],
          ),
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
  name: "search_indicators" | "describe_indicator" | "find_countries" | "show_chart" | "ask_user",
  params: Arguments,
): ReadonlyArray<Response.PartEncoded> => [
  { type: "tool-call", id: `call-${name}`, name, params },
  finish,
]

const brazil = {
  chart: "trend",
  indicator: lifeExpectancy,
  against: null,
  countries: ["BRA"],
  from: 2000,
  to: 2002,
  year: null,
  transform: null,
  per: null,
}

const words = (text: string): ReadonlyArray<Response.PartEncoded> => [
  { type: "text", text },
  finish,
]

type Turn = Effect.Effect<ReadonlyArray<Response.PartEncoded>, AiError.AiError>

// A model that answers each request from a script, in order, and keeps the
// prompts it was sent. Past the script it answers in words.
const scripted = (turns: ReadonlyArray<Turn>) => {
  const prompts: Array<string> = []
  let turn = 0

  const layer = Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: ({ prompt }) => {
        const next = turns[turn] ?? Effect.succeed(words("Done."))

        prompts.push(JSON.stringify(prompt))
        turn += 1

        return Effect.map(next, (parts) => [...parts])
      },
      streamText: () => Stream.die("the agent does not stream"),
    }),
  )

  return { layer, prompts }
}

// The API as the Worker serves it, with each conversation answered in this
// process the way its Durable Object would, from memory.
const serveApi = (model: Layer.Layer<LanguageModel.LanguageModel>, limit = AskLimit.none) =>
  Layer.mergeAll(
    Handlers.pipe(
      Layer.provide(
        Conversations.local(
          () =>
            HttpRouter.toWebHandler(
              serve.pipe(
                Layer.provide(Transcript.memory),
                Layer.provide(
                  Agent.layer.pipe(
                    Layer.provide(model),
                    Layer.provide(Resolver.layer),
                    Layer.provide(catalog),
                    Layer.provide(worldBank),
                  ),
                ),
                Layer.provide(limit),
              ),
            ).handler,
        ),
      ),
      Layer.provide(catalog),
      Layer.provide(worldBank),
    ),
    HttpServer.layerServices,
  )

const client = HttpApiTest.groups(Api, ["conversation"])

const ask = (question: string) =>
  Effect.flatMap(client, (api) => api.conversation.ask({ params: { id }, payload: { question } }))

const answer = (question: string) => ask(question).pipe(Effect.flatMap(Stream.runCollect))

const turns = Effect.flatMap(client, (api) => api.conversation.turns({ params: { id } }))

// The answer in progress. Succeeds once the conversation has looked it up.
const follow = Effect.flatMap(client, (api) => api.conversation.answer({ params: { id } }))

const brazilTrend = Trend.make({
  indicator: lifeExpectancy,
  countries: ["BRA"],
  from: Year.make(2000),
  to: Year.make(2002),
})

describe("conversations", () => {
  it.effect("streams the steps of an answer and keeps the question with its chart", () => {
    const model = scripted([
      Effect.succeed(call("search_indicators", { text: "life expectancy" })),
      Effect.succeed(call("show_chart", brazil)),
    ])

    return Effect.gen(function* () {
      expect(yield* turns).toEqual({ answered: [] })

      expect(yield* answer("How has life expectancy changed in Brazil?")).toEqual([
        Searched.make({ text: "life expectancy" }),
        Answered.make({ view: brazilTrend }),
      ])

      expect(yield* turns).toEqual({
        answered: [
          {
            question: "How has life expectancy changed in Brazil?",
            answer: Answered.make({ view: brazilTrend }),
          },
        ],
      })
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("answers a follow-up with the conversation so far", () => {
    const model = scripted([
      Effect.succeed(call("show_chart", brazil)),
      Effect.succeed(call("show_chart", { ...brazil, countries: ["BRA", "MEX"] })),
    ])

    return Effect.gen(function* () {
      yield* answer("Life expectancy in Brazil")

      const steps = yield* answer("Add Mexico")

      expect(steps.at(-1)).toEqual(
        Answered.make({ view: Trend.make({ ...brazilTrend, countries: ["BRA", "MEX"] }) }),
      )
      expect(model.prompts[1]).toContain("Life expectancy in Brazil")
      expect((yield* turns).answered.map((turn) => turn.question)).toEqual([
        "Life expectancy in Brazil",
        "Add Mexico",
      ])
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("sends the model only the last few questions, and keeps every turn", () => {
    const questions = [
      "First question",
      "Second question",
      "Third question",
      "Fourth question",
      "Fifth question",
    ]

    const model = scripted(questions.map(() => Effect.succeed(call("show_chart", brazil))))

    return Effect.gen(function* () {
      yield* Effect.forEach(questions, answer, { discard: true })

      const last = model.prompts.at(-1)

      expect(last).toContain("You turn a question about countries")
      expect(last).not.toContain("First question")
      expect(last).toContain("Second question")
      expect(last).toContain("Fifth question")
      expect((yield* turns).answered.map((turn) => turn.question)).toEqual(questions)
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("reports a rejected chart and the one that replaced it", () => {
    const model = scripted([
      // An aggregate instead of a country, then years with no data.
      Effect.succeed(call("show_chart", { ...brazil, countries: ["LCN"] })),
      Effect.succeed(call("show_chart", { ...brazil, from: 1960, to: 1961 })),
      Effect.succeed(call("show_chart", brazil)),
    ])

    return Effect.gen(function* () {
      const steps = yield* answer("Life expectancy in Brazil")

      expect(steps.map(Schema.is(Rejected))).toEqual([true, true, false])
      expect(steps.at(-1)).toEqual(Answered.make({ view: brazilTrend }))
      expect(steps[1]).toEqual(
        Rejected.make({
          problem: "The World Bank has no values for these countries and years. Try other years.",
        }),
      )
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  // "Since 2000": the instructions give the model the current year, so it
  // asks for every year up to it, past the World Bank's latest data.
  it.effect("ends a trend at the latest year with data", () => {
    const model = scripted([Effect.succeed(call("show_chart", { ...brazil, to: 2026 }))])

    return Effect.gen(function* () {
      expect((yield* answer("Life expectancy in Brazil since 2000")).at(-1)).toEqual(
        Answered.make({ view: brazilTrend }),
      )
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect(
    "answers with a change between two years, rejecting a transform it does not take",
    () => {
      const change = { ...brazil, chart: "change", from: 2000, to: 2002 }

      const model = scripted([
        Effect.succeed(call("show_chart", { ...change, transform: "Index" })),
        Effect.succeed(call("show_chart", change)),
      ])

      return Effect.gen(function* () {
        const steps = yield* answer("How much did life expectancy in Brazil change since 2000?")

        expect(steps.map(Schema.is(Rejected))).toEqual([true, false])
        expect(steps.at(-1)).toEqual(
          Answered.make({
            view: Change.make({
              indicator: lifeExpectancy,
              countries: ["BRA"],
              from: Year.make(2000),
              to: Year.make(2002),
            }),
          }),
        )
      }).pipe(Effect.provide(serveApi(model.layer)))
    },
  )

  it.effect("answers with a ranking drawn as a world map", () => {
    const model = scripted([
      Effect.succeed(
        call("show_chart", {
          ...brazil,
          chart: "map",
          countries: ["BRA", "MEX"],
          from: null,
          to: null,
          year: 2002,
        }),
      ),
    ])

    return Effect.gen(function* () {
      const steps = yield* answer("Life expectancy across Latin America on a map")

      expect(steps.at(-1)).toEqual(
        Answered.make({
          view: Ranking.make({
            indicator: lifeExpectancy,
            countries: ["BRA", "MEX"],
            year: Year.make(2002),
            as: "Map",
          }),
        }),
      )
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("rejects a relation of an indicator to itself", () => {
    const model = scripted([
      Effect.succeed(
        call("show_chart", {
          ...brazil,
          chart: "relation",
          against: lifeExpectancy,
          from: null,
          to: null,
          year: 2002,
        }),
      ),
    ])

    return Effect.gen(function* () {
      const [step] = yield* answer("Life expectancy against life expectancy in Brazil")

      expect(Schema.is(Rejected)(step)).toBe(true)
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("rejects a ratio of an indicator to itself", () => {
    const model = scripted([
      Effect.succeed(call("show_chart", { ...brazil, transform: "Ratio", per: lifeExpectancy })),
    ])

    return Effect.gen(function* () {
      const [step] = yield* answer("Life expectancy per life expectancy in Brazil")

      expect(Schema.is(Rejected)(step)).toBe(true)
      expect(step).toMatchObject({
        problem: expect.stringContaining("a ratio must divide by another indicator"),
      })
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("keeps a question no indicator answers, without a chart", () => {
    const model = scripted([Effect.succeed(words("No World Bank indicator measures that."))])

    return Effect.gen(function* () {
      expect(yield* answer("What is the meaning of life?")).toEqual([Unanswered.make({})])
      expect(yield* turns).toEqual({
        answered: [{ question: "What is the meaning of life?", answer: Unanswered.make({}) }],
      })
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("reads an indicator's definition to the model when asked to", () => {
    const model = scripted([
      Effect.succeed(call("describe_indicator", { indicator: lifeExpectancy })),
      Effect.succeed(call("show_chart", brazil)),
    ])

    return Effect.gen(function* () {
      expect(yield* answer("Life expectancy in Brazil")).toEqual([
        Described.make({ indicator: lifeExpectancy }),
        Answered.make({ view: brazilTrend }),
      ])
      expect(model.prompts[1]).toContain("The number of years a newborn infant would live.")
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("looks up place names for the model", () => {
    const model = scripted([
      Effect.succeed(call("find_countries", { names: ["Ivory Coast", "Korea"] })),
      Effect.succeed(call("show_chart", brazil)),
    ])

    return Effect.gen(function* () {
      expect((yield* answer("Life expectancy in Ivory Coast and Korea"))[0]).toEqual(
        Located.make({ names: ["Ivory Coast", "Korea"] }),
      )
      // Both Koreas match, so the model sees the name is ambiguous.
      expect(model.prompts[1]).toContain("CIV")
      expect(model.prompts[1]).toContain("KOR")
      expect(model.prompts[1]).toContain("PRK")
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("asks the person to choose, and answers the choice as a follow-up", () => {
    const model = scripted([
      Effect.succeed(
        call("ask_user", {
          question: "Which measure?",
          choices: ["Life expectancy", "Healthy life expectancy"],
        }),
      ),
      Effect.succeed(call("show_chart", brazil)),
    ])

    const asked = Asked.make({
      question: "Which measure?",
      choices: ["Life expectancy", "Healthy life expectancy"],
    })

    return Effect.gen(function* () {
      expect(yield* answer("How long do people live in Brazil?")).toEqual([asked])

      expect((yield* answer("Life expectancy")).at(-1)).toEqual(
        Answered.make({ view: brazilTrend }),
      )
      expect(model.prompts[1]).toContain("Which measure?")
      expect(yield* turns).toEqual({
        answered: [
          { question: "How long do people live in Brazil?", answer: asked },
          { question: "Life expectancy", answer: Answered.make({ view: brazilTrend }) },
        ],
      })
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("fails the answer with AgentUnavailable when the model fails, keeping nothing", () => {
    const model = scripted([
      Effect.fail(
        new AiError.AiError({
          module: "OpenAI",
          method: "generateText",
          reason: new AiError.UnknownError({ description: "upstream 500" }),
        }),
      ),
    ])

    return Effect.gen(function* () {
      const error = yield* answer("Life expectancy in Brazil").pipe(Effect.flip)

      expect(error).toBeInstanceOf(AgentUnavailable)
      expect(yield* turns).toEqual({ answered: [] })
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("refuses a second question while the first is being answered", () =>
    Effect.gen(function* () {
      const reply = yield* Deferred.make<ReadonlyArray<Response.PartEncoded>>()
      const model = scripted([Deferred.await(reply), Effect.succeed(call("show_chart", brazil))])

      return yield* Effect.gen(function* () {
        const first = yield* ask("Life expectancy in Brazil").pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.forkChild,
        )

        yield* Effect.yieldNow

        expect(yield* ask("Add Mexico").pipe(Effect.flip)).toBeInstanceOf(ConversationBusy)

        yield* Deferred.succeed(reply, call("search_indicators", { text: "life expectancy" }))

        expect((yield* Fiber.join(first)).at(-1)).toEqual(Answered.make({ view: brazilTrend }))
      }).pipe(Effect.provide(serveApi(model.layer)))
    }),
  )

  it.effect("finishes and keeps an answer the visitor stopped reading", () =>
    Effect.gen(function* () {
      const reply = yield* Deferred.make<ReadonlyArray<Response.PartEncoded>>()

      const model = scripted([
        Effect.succeed(call("search_indicators", { text: "life expectancy" })),
        Deferred.await(reply),
      ])

      const searched = Searched.make({ text: "life expectancy" })
      const answered = Answered.make({ view: brazilTrend })

      return yield* Effect.gen(function* () {
        // The visitor reads the first step, then closes the tab.
        expect(
          yield* ask("Life expectancy in Brazil").pipe(Effect.flatMap(Stream.runHead)),
        ).toEqual(Option.some(searched))

        expect(yield* turns).toEqual({ answered: [], answering: "Life expectancy in Brazil" })

        // Coming back, they follow the answer from its first step.
        const following = yield* follow

        yield* Deferred.succeed(reply, call("show_chart", brazil))

        expect(yield* Stream.runCollect(following)).toEqual([searched, answered])
        expect(yield* turns).toEqual({
          answered: [{ question: "Life expectancy in Brazil", answer: answered }],
        })
        expect(yield* follow.pipe(Effect.flatMap(Stream.runCollect))).toEqual([])
      }).pipe(Effect.provide(serveApi(model.layer)))
    }),
  )

  it.effect("passes a failed answer on to whoever follows it", () =>
    Effect.gen(function* () {
      const reply = yield* Deferred.make<ReadonlyArray<Response.PartEncoded>, AiError.AiError>()
      const model = scripted([Deferred.await(reply)])

      return yield* Effect.gen(function* () {
        const steps = yield* ask("Life expectancy in Brazil")
        const following = yield* follow

        yield* Deferred.fail(
          reply,
          new AiError.AiError({
            module: "OpenAI",
            method: "generateText",
            reason: new AiError.UnknownError({ description: "upstream 500" }),
          }),
        )

        expect(yield* Stream.runCollect(steps).pipe(Effect.flip)).toBeInstanceOf(AgentUnavailable)
        expect(yield* Stream.runCollect(following).pipe(Effect.flip)).toBeInstanceOf(
          AgentUnavailable,
        )
        expect(yield* turns).toEqual({ answered: [] })
      }).pipe(Effect.provide(serveApi(model.layer)))
    }),
  )

  it.effect("fails with TooManyQuestions before asking the model when over the limit", () => {
    const model = scripted([Effect.die("the model must not be asked")])

    return Effect.gen(function* () {
      expect(yield* ask("Life expectancy in Brazil").pipe(Effect.flip)).toBeInstanceOf(
        TooManyQuestions,
      )
    }).pipe(
      Effect.provide(
        serveApi(
          model.layer,
          Layer.succeed(
            AskLimit,
            AskLimit.of({ count: () => Effect.fail(new TooManyQuestions()) }),
          ),
        ),
      ),
    )
  })
})
