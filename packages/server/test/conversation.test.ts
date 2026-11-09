import {
  AgentUnavailable,
  Answered,
  Api,
  Asked,
  Change,
  ConversationBusy,
  ConversationId,
  Described,
  Dimensions,
  IndicatorId,
  IndicatorNotFound,
  Located,
  Ranking,
  Rejected,
  Searched,
  sourceOf,
  SourceUnavailable,
  Stopped,
  TooManyQuestions,
  Trend,
  Unanswered,
  type View,
  Year,
} from "@civicdata/domain"
import { describe, expect, it } from "@effect/vitest"
import {
  Clock,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Schema,
  Stream,
} from "effect"
import { AiError, LanguageModel, type Response } from "effect/ai"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiTest } from "effect/http-api"
import { TestClock } from "effect/testing"

import { Agent } from "../src/Agent.ts"
import { AskLimit } from "../src/AskLimit.ts"
import { Catalog } from "../src/Catalog.ts"
import { serve } from "../src/ConversationObject.ts"
import { Conversations } from "../src/Conversations.ts"
import { Handlers } from "../src/Handlers.ts"
import { Notes } from "../src/Notes.ts"
import { Resolver } from "../src/Resolver.ts"
import { Sdmx } from "../src/Sdmx.ts"
import { type Storage, Transcript } from "../src/Transcript.ts"
import { WorldBank } from "../src/WorldBank.ts"
import { http, memoryStorage } from "./fakes.ts"
import unemploymentFlow from "./fixtures/eurostat/unemployment-flow.json"
import unemploymentOptions from "./fixtures/eurostat/unemployment-options.csv?raw"
import unemploymentRates from "./fixtures/eurostat/unemployment-total.csv?raw"

const lifeExpectancy = IndicatorId.make("SP.DYN.LE00.IN")

const id = ConversationId.make("0b5d7c1e-8f4a-4c2b-9d3e-1a2b3c4d5e6f")

// A World Bank that publishes life expectancy for Brazil and Mexico, 2000 to 2002.
const recordedWorldBank = Layer.succeed(
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

// A catalog of one indicator from each source. A search finds those whose
// name holds its text, of one source when it names one.
const catalog = Layer.succeed(
  Catalog,
  Catalog.of({
    search: (text, options) =>
      Effect.succeed(
        [
          {
            indicator: lifeExpectancy,
            name: "Life expectancy at birth, total (years)",
            definition: "",
          },
          {
            indicator: IndicatorId.make("ESTAT,UNE_RT_A,1.0"),
            name: "Unemployment by sex and age - annual data",
            definition: "",
          },
          {
            indicator: IndicatorId.make("OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0"),
            name: "Monthly unemployment rates",
            definition: "",
          },
        ].filter(
          ({ indicator, name }) =>
            name.toLowerCase().includes(text.toLowerCase()) &&
            (options?.source === undefined || sourceOf(indicator) === options.source),
        ),
      ),
  }),
)

const finish: Response.PartEncoded = {
  type: "finish",
  reason: "tool-calls",
  usage: { inputTokens: {}, outputTokens: {} },
}

// A tool's arguments as the model sends them: JSON values.
type Arguments = Readonly<
  Record<
    string,
    string | number | null | ReadonlyArray<string> | ReadonlyArray<Readonly<Record<string, string>>>
  >
>

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
  dimensions: null,
}

const words = (text: string): ReadonlyArray<Response.PartEncoded> => [
  { type: "text", text },
  finish,
]

type Turn = Effect.Effect<ReadonlyArray<Response.PartEncoded>, AiError.AiError>

// What the model writes once it has shown a chart, unless a test scripts it.
const takeaway = "Life expectancy rose in Brazil."

// A model that answers each request from a script, in order, and keeps the
// prompts it was sent. Past the script it answers with the takeaway.
const scripted = (turns: ReadonlyArray<Turn>) => {
  const prompts: Array<string> = []
  let turn = 0

  const layer = Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: ({ prompt }) => {
        const next = turns[turn] ?? Effect.succeed(words(takeaway))

        prompts.push(JSON.stringify(prompt))
        turn += 1

        return Effect.map(next, (parts) => [...parts])
      },
      streamText: () => Stream.die("the agent does not stream"),
    }),
  )

  return { layer, prompts }
}

const eurostat = "https://ec.europa.eu/eurostat/api/dissemination"

const totalAged15To74 = Schema.decodeSync(Dimensions)({ age: "Y15-74", unit: "PC_ACT", sex: "T" })

// Eurostat as recorded on 2026-11-09: unemployment rates for France, which
// come in several series, and the total for 15 to 74 year-olds.
const recordedSdmx = Sdmx.layer.pipe(
  Layer.provide(
    http(
      (url) =>
        new Map([
          [
            `${eurostat}/sdmx/2.1/dataflow/ESTAT/UNE_RT_A/1.0?format=JSON`,
            globalThis.Response.json(unemploymentFlow),
          ],
          [
            `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/UNE_RT_A/1.0/*?c[geo]=FR&c[freq]=A&lastNObservations=1&compress=false`,
            new globalThis.Response(unemploymentOptions),
          ],
          [
            `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/UNE_RT_A/1.0/*?c[geo]=FR&c[freq]=A&c[age]=Y15-74&c[unit]=PC_ACT&c[sex]=T&c[TIME_PERIOD]=ge:2022+le:2024&compress=false`,
            new globalThis.Response(unemploymentRates),
          ],
        ]).get(url) ?? new globalThis.Response("no recording", { status: 404 }),
    ),
  ),
)

// These tests read no indicator notes.
const notes = Layer.succeed(Notes, Notes.of({ get: () => Effect.die("no notes in these tests") }))

interface ServeOptions {
  readonly limit?: Layer.Layer<AskLimit>
  // The sources, when a test needs one to fail.
  readonly worldBank?: Layer.Layer<WorldBank>
  readonly sdmx?: Layer.Layer<Sdmx>
  // The conversations' Durable Object storage. Without it, each conversation
  // keeps its transcript in memory.
  readonly storage?: Storage
}

// The API as the Worker serves it, with each conversation answered in this
// process the way its Durable Object would, on the test's clock.
const serveApi = (
  model: Layer.Layer<LanguageModel.LanguageModel>,
  {
    limit = AskLimit.none,
    storage,
    worldBank = recordedWorldBank,
    sdmx = recordedSdmx,
  }: ServeOptions = {},
) => {
  const agent = Agent.layer.pipe(
    Layer.provide(model),
    Layer.provide(Resolver.layer),
    Layer.provide(catalog),
    Layer.provide(worldBank),
    Layer.provide(sdmx),
  )

  const transcript = storage === undefined ? Transcript.memory : Transcript.durable(storage)

  return Layer.unwrap(
    Effect.clockWith((clock) =>
      Effect.succeed(
        Layer.mergeAll(
          Handlers.pipe(
            Layer.provide(
              Conversations.local(
                () =>
                  HttpRouter.toWebHandler(
                    serve.pipe(
                      Layer.provide(transcript),
                      Layer.provide(agent),
                      Layer.provide(limit),
                      Layer.provideMerge(Layer.succeed(Clock.Clock, clock)),
                    ),
                  ).handler,
              ),
            ),
            Layer.provide(agent),
            Layer.provide(limit),
            Layer.provide(notes),
            Layer.provide(catalog),
            Layer.provide(worldBank),
            Layer.provide(sdmx),
          ),
          HttpServer.layerServices,
        ),
      ),
    ),
  )
}

const client = HttpApiTest.groups(Api, ["conversation"])

const ask = (question: string) =>
  Effect.flatMap(client, (api) => api.conversation.ask({ params: { id }, payload: { question } }))

const answer = (question: string) => ask(question).pipe(Effect.flatMap(Stream.runCollect))

const turns = Effect.flatMap(client, (api) => api.conversation.turns({ params: { id } }))

// The answer in progress. Succeeds once the conversation has looked it up.
const follow = Effect.flatMap(client, (api) => api.conversation.answer({ params: { id } }))

const stop = Effect.flatMap(client, (api) => api.conversation.stop({ params: { id } }))

const brazilTrend = Trend.make({
  indicator: lifeExpectancy,
  countries: ["BRA"],
  from: Year.make(2000),
  to: Year.make(2002),
})

describe("conversations", () => {
  it.effect("streams the steps of an answer and keeps the question with its chart", () => {
    const model = scripted([
      Effect.succeed(call("search_indicators", { text: "life expectancy", source: null })),
      Effect.succeed(call("show_chart", brazil)),
    ])

    return Effect.gen(function* () {
      expect(yield* turns).toEqual({ answered: [] })

      expect(yield* answer("How has life expectancy changed in Brazil?")).toEqual([
        Searched.make({ text: "life expectancy", found: ["World Bank"] }),
        Answered.make({ view: brazilTrend, takeaway }),
      ])

      expect(yield* turns).toEqual({
        answered: [
          {
            question: "How has life expectancy changed in Brazil?",
            answer: Answered.make({ view: brazilTrend, takeaway }),
            steps: [Searched.make({ text: "life expectancy", found: ["World Bank"] })],
            took: Duration.zero,
          },
        ],
      })
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("answers a follow-up with the conversation so far", () => {
    const model = scripted([
      Effect.succeed(call("show_chart", brazil)),
      Effect.succeed(words(takeaway)),
      Effect.succeed(call("show_chart", { ...brazil, countries: ["BRA", "MEX"] })),
    ])

    return Effect.gen(function* () {
      yield* answer("Life expectancy in Brazil")

      const steps = yield* answer("Add Mexico")

      expect(steps.at(-1)).toEqual(
        Answered.make({
          view: Trend.make({ ...brazilTrend, countries: ["BRA", "MEX"] }),
          takeaway,
        }),
      )
      expect(model.prompts[2]).toContain("Life expectancy in Brazil")
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

    const model = scripted(
      questions.flatMap(() => [
        Effect.succeed(call("show_chart", brazil)),
        Effect.succeed(words(takeaway)),
      ]),
    )

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
      expect(steps.at(-1)).toEqual(Answered.make({ view: brazilTrend, takeaway }))
      expect(steps[1]).toEqual(
        Rejected.make({
          problem: "The World Bank has no values for these countries and years. Try other years.",
        }),
      )
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("writes the takeaway from a summary of the charted values", () => {
    const model = scripted([
      Effect.succeed(call("show_chart", brazil)),
      Effect.succeed(words("  Life expectancy in Brazil rose every year.  ")),
    ])

    const answered = Answered.make({
      view: brazilTrend,
      takeaway: "Life expectancy in Brazil rose every year.",
    })

    return Effect.gen(function* () {
      expect(yield* answer("Life expectancy in Brazil")).toEqual([answered])
      // Brazil's line runs from 70 in 2000 to 72 in 2002.
      expect(model.prompts[1]).toContain(
        '"first":{"year":2000,"value":70},"last":{"year":2002,"value":72}',
      )
      expect((yield* turns).answered[0]?.answer).toEqual(answered)
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("keeps a takeaway's numbers only when they come from the charted values", () => {
    const model = scripted([
      Effect.succeed(call("show_chart", brazil)),
      Effect.succeed(words("Life expectancy in Brazil rose from 70 years in 2000 to 72 in 2002.")),
      Effect.succeed(call("show_chart", brazil)),
      // 72 - 70, worked out by the model.
      Effect.succeed(words("Life expectancy in Brazil rose by 2 years.")),
    ])

    return Effect.gen(function* () {
      expect(yield* answer("Life expectancy in Brazil")).toEqual([
        Answered.make({
          view: brazilTrend,
          takeaway: "Life expectancy in Brazil rose from 70 years in 2000 to 72 in 2002.",
        }),
      ])
      expect(yield* answer("Show it again")).toEqual([Answered.make({ view: brazilTrend })])
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("shows the chart without a takeaway when the model fails to write one", () => {
    const model = scripted([
      Effect.succeed(call("show_chart", brazil)),
      Effect.fail(
        new AiError.AiError({
          module: "OpenAI",
          method: "generateText",
          reason: new AiError.UnknownError({ description: "upstream 500" }),
        }),
      ),
    ])

    return Effect.gen(function* () {
      expect(yield* answer("Life expectancy in Brazil")).toEqual([
        Answered.make({ view: brazilTrend }),
      ])
      expect((yield* turns).answered[0]?.answer).toEqual(Answered.make({ view: brazilTrend }))
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  // "Since 2000": the instructions give the model the current year, so it
  // asks for every year up to it, past the World Bank's latest data.
  it.effect("ends a trend at the latest year with data", () => {
    const model = scripted([Effect.succeed(call("show_chart", { ...brazil, to: 2026 }))])

    return Effect.gen(function* () {
      expect((yield* answer("Life expectancy in Brazil since 2000")).at(-1)).toEqual(
        Answered.make({ view: brazilTrend, takeaway }),
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
            takeaway,
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
          takeaway,
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

  it.effect(
    "tells the model which values a Eurostat dataflow's dimensions take, then shows its pick",
    () => {
      const unemployment = {
        ...brazil,
        indicator: "ESTAT,UNE_RT_A,1.0",
        countries: ["FRA"],
        from: 2022,
        to: 2024,
      }

      const model = scripted([
        Effect.succeed(call("show_chart", unemployment)),
        Effect.succeed(
          call("show_chart", {
            ...unemployment,
            dimensions: [
              { dimension: "age", code: "Y15-74" },
              { dimension: "unit", code: "PC_ACT" },
              { dimension: "sex", code: "T" },
            ],
          }),
        ),
      ])

      return Effect.gen(function* () {
        const steps = yield* answer("Unemployment in France")
        const [first] = steps

        expect(Schema.is(Rejected)(first) ? first.problem : "").toContain(
          "sex (F Females, M Males, T Total)",
        )
        expect(steps.at(-1)).toEqual(
          Answered.make({
            view: Trend.make({
              indicator: IndicatorId.make("ESTAT,UNE_RT_A,1.0"),
              countries: ["FRA"],
              from: Year.make(2022),
              to: Year.make(2024),
              dimensions: totalAged15To74,
            }),
            takeaway,
          }),
        )
      }).pipe(Effect.provide(serveApi(model.layer)))
    },
  )

  it.effect("keeps a question no indicator answers, without a chart", () => {
    const model = scripted([Effect.succeed(words("No World Bank indicator measures that."))])

    return Effect.gen(function* () {
      expect(yield* answer("What is the meaning of life?")).toEqual([Unanswered.make({})])
      expect(yield* turns).toEqual({
        answered: [
          {
            question: "What is the meaning of life?",
            answer: Unanswered.make({}),
            steps: [],
            took: Duration.zero,
          },
        ],
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
        Answered.make({ view: brazilTrend, takeaway }),
      ])
      expect(model.prompts[1]).toContain("The number of years a newborn infant would live.")
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("searches every source, or one the model names, and reports which each found", () => {
    const model = scripted([
      Effect.succeed(call("search_indicators", { text: "unemployment", source: null })),
      Effect.succeed(call("search_indicators", { text: "unemployment", source: "Eurostat" })),
      Effect.succeed(call("search_indicators", { text: "happiness", source: null })),
      Effect.succeed(words("No indicator measures that.")),
    ])

    return Effect.gen(function* () {
      expect(yield* answer("Unemployment in France")).toEqual([
        Searched.make({ text: "unemployment", found: ["Eurostat", "OECD"] }),
        Searched.make({ text: "unemployment", source: "Eurostat", found: ["Eurostat"] }),
        Searched.make({ text: "happiness", found: [] }),
        Unanswered.make({}),
      ])
      // The model reads each match's source.
      expect(model.prompts[1]).toContain('"source":"OECD"')
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("reads a Eurostat dataflow's name and source to the model", () => {
    const model = scripted([
      Effect.succeed(call("describe_indicator", { indicator: "ESTAT,UNE_RT_A,1.0" })),
      Effect.succeed(words("No chart.")),
    ])

    return Effect.gen(function* () {
      expect((yield* answer("Unemployment in France"))[0]).toEqual(
        Described.make({ indicator: IndicatorId.make("ESTAT,UNE_RT_A,1.0") }),
      )
      expect(model.prompts[1]).toContain('"name":"Unemployment by sex and age - annual data"')
      expect(model.prompts[1]).toContain('"source":"Eurostat"')
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("tells the model when a Eurostat dataflow has no annual values", () => {
    const model = scripted([
      Effect.succeed(
        call("show_chart", {
          ...brazil,
          indicator: "ESTAT,UNE_RT_A,1.0",
          countries: ["FRA"],
          from: 2022,
          to: 2024,
          dimensions: [
            { dimension: "age", code: "Y15-74" },
            { dimension: "unit", code: "PC_ACT" },
            { dimension: "sex", code: "T" },
          ],
        }),
      ),
      Effect.succeed(words("No chart.")),
    ])

    // Eurostat answers that the query matches no annual values.
    const quarterly = Sdmx.layer.pipe(
      Layer.provide(
        http((url) =>
          url.includes("/sdmx/2.1/dataflow/")
            ? globalThis.Response.json(unemploymentFlow)
            : new globalThis.Response("INVALID_QUERY_DIMENSION_VALUE", { status: 400 }),
        ),
      ),
    )

    return Effect.gen(function* () {
      expect((yield* answer("Unemployment in France"))[0]).toEqual(
        Rejected.make({
          problem:
            "Eurostat has no annual values for these countries and years. Try other years, or another dataflow if this one is quarterly or monthly only.",
        }),
      )
    }).pipe(Effect.provide(serveApi(model.layer, { sdmx: quarterly })))
  })

  // A source that refuses every request, as one over its rate limit does.
  const refusing = Sdmx.layer.pipe(
    Layer.provide(http(() => new globalThis.Response("Too many requests", { status: 429 }))),
  )

  const failing = Layer.succeed(
    WorldBank,
    WorldBank.of({
      describe: () => Effect.fail(new SourceUnavailable({ source: "World Bank" })),
      observations: () => Effect.fail(new SourceUnavailable({ source: "World Bank" })),
      indicators: Effect.fail(new SourceUnavailable({ source: "World Bank" })),
    }),
  )

  const unavailable = [
    { source: "World Bank", indicator: lifeExpectancy, options: { worldBank: failing } },
    { source: "Eurostat", indicator: "ESTAT,UNE_RT_A,1.0", options: { sdmx: refusing } },
    {
      source: "OECD",
      indicator: "OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0",
      options: { sdmx: refusing },
    },
  ] as const

  for (const { source, indicator, options } of unavailable) {
    it.effect(`fails the answer with SourceUnavailable when ${source} is unreachable`, () => {
      const model = scripted([Effect.succeed(call("describe_indicator", { indicator }))])

      return Effect.gen(function* () {
        const error = yield* answer("Unemployment in France").pipe(Effect.flip)

        expect(error).toEqual(new SourceUnavailable({ source }))
        expect(yield* turns).toEqual({ answered: [] })
      }).pipe(Effect.provide(serveApi(model.layer, options)))
    })
  }

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
        Answered.make({ view: brazilTrend, takeaway }),
      )
      expect(model.prompts[1]).toContain("Which measure?")
      expect(yield* turns).toEqual({
        answered: [
          {
            question: "How long do people live in Brazil?",
            answer: asked,
            steps: [],
            took: Duration.zero,
          },
          {
            question: "Life expectancy",
            answer: Answered.make({ view: brazilTrend, takeaway }),
            steps: [],
            took: Duration.zero,
          },
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

        yield* Deferred.succeed(
          reply,
          call("search_indicators", { text: "life expectancy", source: null }),
        )

        expect((yield* Fiber.join(first)).at(-1)).toEqual(
          Answered.make({ view: brazilTrend, takeaway }),
        )
      }).pipe(Effect.provide(serveApi(model.layer)))
    }),
  )

  it.effect("finishes and keeps an answer the visitor stopped reading", () =>
    Effect.gen(function* () {
      const reply = yield* Deferred.make<ReadonlyArray<Response.PartEncoded>>()

      const model = scripted([
        Effect.succeed(call("search_indicators", { text: "life expectancy", source: null })),
        Deferred.await(reply),
      ])

      const searched = Searched.make({ text: "life expectancy", found: ["World Bank"] })
      const answered = Answered.make({ view: brazilTrend, takeaway })

      return yield* Effect.gen(function* () {
        // The visitor reads the first step, then closes the tab.
        expect(
          yield* ask("Life expectancy in Brazil").pipe(Effect.flatMap(Stream.runHead)),
        ).toEqual(Option.some(searched))

        expect(yield* turns).toEqual({
          answered: [],
          answering: { question: "Life expectancy in Brazil", started: DateTime.makeUnsafe(0) },
        })

        // Coming back, they follow the answer from its first step.
        const following = yield* follow

        yield* Deferred.succeed(reply, call("show_chart", brazil))

        expect(yield* Stream.runCollect(following)).toEqual([searched, answered])
        expect(yield* turns).toEqual({
          answered: [
            {
              question: "Life expectancy in Brazil",
              answer: answered,
              steps: [searched],
              took: Duration.zero,
            },
          ],
        })
        expect(yield* follow.pipe(Effect.flatMap(Stream.runCollect))).toEqual([])
      }).pipe(Effect.provide(serveApi(model.layer)))
    }),
  )

  it.effect("stops an answer mid-way and keeps its turn as stopped", () =>
    Effect.gen(function* () {
      const waiting = yield* Deferred.make<void>()
      const seen = yield* Deferred.make<void>()
      const reply = yield* Deferred.make<ReadonlyArray<Response.PartEncoded>>()

      const model = scripted([
        Effect.succeed(call("search_indicators", { text: "life expectancy", source: null })),
        Deferred.succeed(waiting, undefined).pipe(Effect.andThen(Deferred.await(reply))),
      ])

      const stopped = {
        question: "Life expectancy in Brazil",
        answer: Stopped.make({}),
        steps: [Searched.make({ text: "life expectancy", found: ["World Bank"] })],
        took: Duration.seconds(6),
      }

      return yield* Effect.gen(function* () {
        const steps = yield* ask("Life expectancy in Brazil").pipe(
          Effect.flatMap((stream) =>
            stream.pipe(
              Stream.tap(() => Deferred.succeed(seen, undefined)),
              Stream.runCollect,
            ),
          ),
          Effect.forkChild,
        )

        // The visitor has seen the first step and the agent waits on the model.
        yield* Deferred.await(seen)
        yield* Deferred.await(waiting)
        yield* TestClock.adjust("6 seconds")
        yield* stop

        expect(yield* Fiber.join(steps)).toEqual([
          Searched.make({ text: "life expectancy", found: ["World Bank"] }),
          Stopped.make({}),
        ])
        expect(yield* turns).toEqual({ answered: [stopped] })

        // The model's late reply is dropped: the agent was cut off.
        yield* Deferred.succeed(reply, call("show_chart", brazil))
        yield* Effect.yieldNow

        expect(yield* turns).toEqual({ answered: [stopped] })
        expect(model.prompts).toHaveLength(2)

        // The next question is answered without the stopped one.
        expect((yield* answer("Life expectancy in Mexico")).at(-1)).toEqual(Unanswered.make({}))
        expect(model.prompts.at(-1)).not.toContain("Brazil")
      }).pipe(Effect.provide(serveApi(model.layer)))
    }),
  )

  it.effect("keeps an answer that ended before the stop", () => {
    const model = scripted([Effect.succeed(call("show_chart", brazil))])

    return Effect.gen(function* () {
      yield* answer("Life expectancy in Brazil")
      yield* stop

      expect(yield* turns).toEqual({
        answered: [
          {
            question: "Life expectancy in Brazil",
            answer: Answered.make({ view: brazilTrend, takeaway }),
            steps: [],
            took: Duration.zero,
          },
        ],
      })
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("keeps what the agent did and how long it took for the next visit", () =>
    Effect.gen(function* () {
      const reply = yield* Deferred.make<ReadonlyArray<Response.PartEncoded>>()
      const question = "Life expectancy in Brazil"
      const { fake } = memoryStorage()

      const model = scripted([
        Effect.succeed(call("search_indicators", { text: "life expectancy", source: null })),
        Effect.succeed(call("describe_indicator", { indicator: lifeExpectancy })),
        Deferred.await(reply),
      ])

      yield* Effect.gen(function* () {
        const steps = yield* ask(question)
        const answering = yield* Stream.runCollect(steps).pipe(Effect.forkChild)

        expect(yield* turns).toEqual({
          answered: [],
          answering: { question, started: DateTime.makeUnsafe(0) },
        })

        yield* TestClock.adjust("8 seconds")
        yield* Deferred.succeed(reply, call("show_chart", brazil))
        yield* Fiber.join(answering)
      }).pipe(Effect.provide(serveApi(model.layer, { storage: fake })))

      // The conversation's object starts afresh from its storage.
      yield* Effect.gen(function* () {
        expect(yield* turns).toEqual({
          answered: [
            {
              question,
              answer: Answered.make({ view: brazilTrend, takeaway }),
              steps: [
                Searched.make({ text: "life expectancy", found: ["World Bank"] }),
                Described.make({ indicator: lifeExpectancy }),
              ],
              took: Duration.seconds(8),
            },
          ],
        })
      }).pipe(Effect.provide(serveApi(scripted([]).layer, { storage: fake })))
    }),
  )

  it.effect("reads turns saved before the work log without steps or time", () => {
    const saved = {
      chat: "[]",
      turns: [
        {
          question: "What is the meaning of life?",
          answer: Schema.encodeSync(Unanswered)(Unanswered.make({})),
        },
      ],
    }

    const { fake } = memoryStorage(new Map([["conversation", JSON.stringify(saved)]]))

    return Effect.gen(function* () {
      expect(yield* turns).toEqual({
        answered: [{ question: "What is the meaning of life?", answer: Unanswered.make({}) }],
      })
    }).pipe(Effect.provide(serveApi(scripted([]).layer, { storage: fake })))
  })

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
        serveApi(model.layer, {
          limit: Layer.succeed(
            AskLimit,
            AskLimit.of({ count: () => Effect.fail(new TooManyQuestions()) }),
          ),
        }),
      ),
    )
  })
})

describe("explaining a chart", () => {
  const views = HttpApiTest.groups(Api, ["views"])

  const explain = (view: View) =>
    Effect.flatMap(views, (api) => api.views.explain({ payload: view }))

  const fails = Effect.fail(
    new AiError.AiError({
      module: "OpenAI",
      method: "generateText",
      reason: new AiError.UnknownError({ description: "upstream 500" }),
    }),
  )

  it.effect("writes a takeaway for a chart from a summary of its values", () => {
    const written = "Life expectancy in Brazil rose from 70 years in 2000 to 72 in 2002."
    const model = scripted([Effect.succeed(words(written))])

    return Effect.gen(function* () {
      expect(yield* explain(brazilTrend)).toEqual(
        Answered.make({ view: brazilTrend, takeaway: written }),
      )
      expect(model.prompts[0]).toContain(
        '\\"first\\":{\\"year\\":2000,\\"value\\":70},\\"last\\":{\\"year\\":2002,\\"value\\":72}',
      )
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("fails with TooManyQuestions before asking the model when over the limit", () => {
    const model = scripted([Effect.die("the model must not be asked")])

    return Effect.gen(function* () {
      expect(yield* explain(brazilTrend).pipe(Effect.flip)).toBeInstanceOf(TooManyQuestions)
    }).pipe(
      Effect.provide(
        serveApi(model.layer, {
          limit: Layer.succeed(
            AskLimit,
            AskLimit.of({ count: () => Effect.fail(new TooManyQuestions()) }),
          ),
        }),
      ),
    )
  })

  it.effect("fails with AgentUnavailable when the model fails", () => {
    const model = scripted([fails])

    return Effect.gen(function* () {
      expect(yield* explain(brazilTrend).pipe(Effect.flip)).toBeInstanceOf(AgentUnavailable)
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("fails with IndicatorNotFound for an indicator the World Bank does not have", () => {
    const model = scripted([Effect.die("the model must not be asked")])

    return Effect.gen(function* () {
      const unknown = Trend.make({ ...brazilTrend, indicator: IndicatorId.make("NOPE") })

      expect(yield* explain(unknown).pipe(Effect.flip)).toBeInstanceOf(IndicatorNotFound)
    }).pipe(Effect.provide(serveApi(model.layer)))
  })
})
