import {
  AgentUnavailable,
  Answered,
  Api,
  Asked,
  Change,
  type Chart,
  ChartIndex,
  ConversationBusy,
  Checked,
  ConversationId,
  Definition,
  DimensionId,
  Dimensions,
  Drawn,
  Dropped,
  Explained,
  Failed,
  Fetch,
  Fetched,
  Halted,
  IndicatorId,
  IndicatorNotFound,
  Located,
  Lookup,
  NoChart,
  put,
  Ranking,
  Read,
  Rejected,
  Rejection,
  Running,
  Search,
  Searched,
  sourceOf,
  SourceUnavailable,
  type Step,
  StepId,
  Stopped,
  Takeaway,
  Thinking,
  Thought,
  TooManyQuestions,
  Trend,
  TurnIndex,
  TurnNotFound,
  Turns,
  Unanswered,
  View,
  Year,
} from "@civicdata/domain"
import { describe, expect, it } from "@effect/vitest"
import {
  type Array as Arr,
  Clock,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Predicate,
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
import { Politics } from "../src/Politics.ts"
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

type Name =
  | "search_indicators"
  | "describe_indicator"
  | "find_countries"
  | "show_chart"
  | "ask_user"

// A tool call, with an id of its own when an answer calls the tool twice.
const call = (
  name: Name,
  params: Arguments,
  { step = `call-${name}` }: { step?: string } = {},
): ReadonlyArray<Response.PartEncoded> => [{ type: "tool-call", id: step, name, params }, finish]

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

// The model answers in words after a takeaway: it has no more charts to draw.
const done = Effect.succeed(words("That answers the question."))

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
            Layer.provide(Politics.unavailable),
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

// Changes the chart at `chart` in the turn at `turn`, the first chart unless
// a test names another.
const show = (turn: number, view: View, { chart = 0 }: { chart?: number } = {}) =>
  Effect.flatMap(client, (api) =>
    api.conversation.show({
      params: { id, turn: TurnIndex.make(turn), chart: ChartIndex.make(chart) },
      payload: view,
    }),
  )

// An answer of these charts, in order.
const charted = (...charts: Arr.NonEmptyReadonlyArray<Chart>) => Answered.make({ charts })

const encodeTurns = Schema.encodeSync(Schema.toCodecJson(Turns))

const isDefinition = Schema.is(Definition)

// Ten countries: enough for a map. The World Bank here has values for
// Brazil and Mexico only.
const latinAmerica = ["BRA", "MEX", "ARG", "CHL", "COL", "PER", "ECU", "BOL", "URY", "PRY"] as const

const brazilTrend = Trend.make({
  indicator: lifeExpectancy,
  countries: ["BRA"],
  from: Year.make(2000),
  to: Year.make(2002),
})

const running = Running.make({})

// The model deciding in a round: running, then done once a tool starts or it answers.
const thinking = (round: number) => {
  const step = StepId.make(`thinking-${round}`)

  return [
    Thinking.make({ id: step, state: running }),
    Thinking.make({ id: step, state: Thought.make({}) }),
  ]
}

// A search for life expectancy, which finds one World Bank indicator.
const searched = (
  state: typeof Search.Type.state = Searched.make({
    count: 1,
    top: [{ indicator: lifeExpectancy, name: "Life expectancy at birth, total (years)" }],
  }),
) => Search.make({ id: StepId.make("call-search_indicators"), text: "life expectancy", state })

interface Fetching {
  readonly step?: string
  readonly view?: View
}

// Brazil's life expectancy fetched: three values, 2000 to 2002.
const fetched = (
  state: typeof Fetch.Type.state = Fetched.make({ values: 3 }),
  { step = "call-show_chart", view = brazilTrend }: Fetching = {},
) => Fetch.make({ id: StepId.make(step), view, state })

// The takeaway of the answer's first chart, or of the one at `chart`,
// written and checked, with no number in it.
const wrote = (
  state: typeof Takeaway.Type.state = Checked.make({ numbers: 0 }),
  { chart = 0 }: { chart?: number } = {},
) => Takeaway.make({ id: StepId.make(`takeaway-${chart}`), state })

// The chart at `chart` in the answer, the first unless a test names another,
// as the agent draws it: Brazil's trend unless a test names another view.
const drew = (
  state: typeof Drawn.Type.state,
  { chart = 0, view = brazilTrend }: { chart?: number; view?: View } = {},
) => Drawn.make({ id: StepId.make(`drawn-${chart}`), view, state })

const isThinking = Schema.is(Thinking)
const isDrawn = Schema.is(Drawn)

// The work log: each step as it last was, in the order they started, without
// the model's thinking or the charts drawn.
const log = (steps: ReadonlyArray<Step>) =>
  steps.reduce(put<Step>, []).filter((step) => !isThinking(step) && !isDrawn(step))

describe("conversations", () => {
  it.effect("streams the steps of an answer and keeps the question with its chart", () => {
    const model = scripted([
      Effect.succeed(call("search_indicators", { text: "life expectancy", source: null })),
      Effect.succeed(call("show_chart", brazil)),
    ])

    return Effect.gen(function* () {
      expect(yield* turns).toEqual({ answered: [] })

      // Each round thinks before its tools, and each tool reports running,
      // then done with what it found. The chart's takeaway follows it, and
      // a last round finds nothing more to draw.
      expect(yield* answer("How has life expectancy changed in Brazil?")).toEqual([
        ...thinking(0),
        searched(running),
        searched(),
        ...thinking(1),
        fetched(running),
        fetched(),
        // The chart goes out as soon as it is drawn, and again with its
        // takeaway.
        drew(running),
        wrote(running),
        wrote(),
        drew(Explained.make({ takeaway })),
        ...thinking(2),
        charted({ view: brazilTrend, takeaway }),
      ])

      expect(yield* turns).toEqual({
        answered: [
          {
            question: "How has life expectancy changed in Brazil?",
            answer: charted({ view: brazilTrend, takeaway }),
            steps: [searched(), fetched(), wrote()],
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
      done,
      Effect.succeed(call("show_chart", { ...brazil, countries: ["BRA", "MEX"] })),
    ])

    return Effect.gen(function* () {
      yield* answer("Life expectancy in Brazil")

      const steps = yield* answer("Add Mexico")

      expect(steps.at(-1)).toEqual(
        charted({
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
        done,
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

  it.effect("reports why the data rejected a chart, and the one that replaced it", () => {
    const model = scripted([
      // An aggregate instead of a country, then years with no data.
      Effect.succeed(call("show_chart", { ...brazil, countries: ["LCN"] }, { step: "chart-1" })),
      Effect.succeed(call("show_chart", { ...brazil, from: 1960, to: 1961 }, { step: "chart-2" })),
      Effect.succeed(call("show_chart", brazil, { step: "chart-3" })),
    ])

    return Effect.gen(function* () {
      const steps = yield* answer("Life expectancy in Brazil")

      // A chart that is not one at all is the model's to fix; people see
      // only the charts the data was fetched for.
      expect(log(steps)).toEqual([
        fetched(Rejected.make({ reason: Rejection.cases.NoValues.make({}) }), {
          step: "chart-2",
          view: Trend.make({ ...brazilTrend, from: Year.make(1960), to: Year.make(1961) }),
        }),
        fetched(undefined, { step: "chart-3" }),
        wrote(),
        charted({ view: brazilTrend, takeaway }),
      ])
      expect(model.prompts[1]).toContain("LCN")
      expect(model.prompts[2]).toContain(
        "The World Bank has no values for these countries and years. Try other years.",
      )
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("writes the takeaway from a summary of the charted values", () => {
    const model = scripted([
      Effect.succeed(call("show_chart", brazil)),
      Effect.succeed(words("  Life expectancy in Brazil rose every year.  ")),
    ])

    const answered = charted({
      view: brazilTrend,
      takeaway: "Life expectancy in Brazil rose every year.",
    })

    return Effect.gen(function* () {
      expect((yield* answer("Life expectancy in Brazil")).at(-1)).toEqual(answered)
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
      done,
      Effect.succeed(call("show_chart", brazil)),
      // 72 - 70, worked out by the model.
      Effect.succeed(words("Life expectancy in Brazil rose by 2 years.")),
    ])

    return Effect.gen(function* () {
      expect(log(yield* answer("Life expectancy in Brazil")).slice(-2)).toEqual([
        // 70, 2000, 72 and 2002.
        wrote(Checked.make({ numbers: 4 })),
        charted({
          view: brazilTrend,
          takeaway: "Life expectancy in Brazil rose from 70 years in 2000 to 72 in 2002.",
        }),
      ])
      expect(log(yield* answer("Show it again")).slice(-2)).toEqual([
        wrote(Dropped.make({})),
        charted({ view: brazilTrend }),
      ])
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
      expect(log(yield* answer("Life expectancy in Brazil")).slice(-2)).toEqual([
        wrote(Failed.make({ reason: new AgentUnavailable() })),
        charted({ view: brazilTrend }),
      ])
      expect((yield* turns).answered[0]?.answer).toEqual(charted({ view: brazilTrend }))
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  // "Since 2000": the instructions give the model the current year, so it
  // asks for every year up to it, past the World Bank's latest data.
  it.effect("ends a trend at the latest year with data", () => {
    const model = scripted([Effect.succeed(call("show_chart", { ...brazil, to: 2026 }))])

    return Effect.gen(function* () {
      expect((yield* answer("Life expectancy in Brazil since 2000")).at(-1)).toEqual(
        charted({ view: brazilTrend, takeaway }),
      )
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect(
    "answers with a change between two years, rejecting a transform it does not take",
    () => {
      const change = { ...brazil, chart: "change", from: 2000, to: 2002 }

      const model = scripted([
        Effect.succeed(call("show_chart", { ...change, transform: "Index" }, { step: "chart-1" })),
        Effect.succeed(call("show_chart", change, { step: "chart-2" })),
      ])

      return Effect.gen(function* () {
        const steps = yield* answer("How much did life expectancy in Brazil change since 2000?")

        expect(model.prompts[1]).toContain("Index")
        expect(steps.at(-1)).toEqual(
          charted({
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
          countries: latinAmerica,
          from: null,
          to: null,
          year: 2002,
        }),
      ),
    ])

    return Effect.gen(function* () {
      const steps = yield* answer("Life expectancy across Latin America on a map")

      expect(steps.at(-1)).toEqual(
        charted({
          view: Ranking.make({
            indicator: lifeExpectancy,
            countries: latinAmerica,
            year: Year.make(2002),
            as: "Map",
          }),
          takeaway,
        }),
      )
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect(
    "rejects a trend of too many countries to read without fetching it, and names a chart that fits",
    () => {
      const seven = ["BRA", "MEX", "ARG", "CHL", "COL", "PER", "ECU"] as const
      const asked: Array<ReadonlyArray<string>> = []

      // The World Bank as recorded, noting which countries each request asks for.
      const worldBank = Layer.effect(
        WorldBank,
        Effect.map(WorldBank, (recorded) =>
          WorldBank.of({
            ...recorded,
            observations: (query) => {
              asked.push(query.countries)

              return recorded.observations(query)
            },
          }),
        ),
      ).pipe(Layer.provide(recordedWorldBank))

      const model = scripted([
        Effect.succeed(call("show_chart", { ...brazil, countries: seven }, { step: "chart-1" })),
        Effect.succeed(
          call("show_chart", { ...brazil, chart: "change", countries: seven }, { step: "chart-2" }),
        ),
      ])

      return Effect.gen(function* () {
        const steps = yield* answer("Life expectancy in Latin America since 2000")

        expect(log(steps)[0]).toEqual(
          fetched(Rejected.make({ reason: Rejection.cases.TooMany.make({ most: 6 }) }), {
            step: "chart-1",
            view: Trend.make({ ...brazilTrend, countries: seven }),
          }),
        )
        expect(model.prompts[1]).toContain(
          "Too many countries for a trend: 7, at most 6. Instead, use a ranking or a map for one year, a change for two years, or pick up to 6 countries.",
        )
        // Only the change was fetched.
        expect(asked).toEqual([seven])
        expect(steps.at(-1)).toEqual(
          charted({
            view: Change.make({
              indicator: lifeExpectancy,
              countries: seven,
              from: Year.make(2000),
              to: Year.make(2002),
            }),
            takeaway,
          }),
        )
      }).pipe(Effect.provide(serveApi(model.layer, { worldBank })))
    },
  )

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
      yield* answer("Life expectancy against life expectancy in Brazil")

      expect(model.prompts[1]).toContain("against must be another indicator")
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("rejects a ratio of an indicator to itself", () => {
    const model = scripted([
      Effect.succeed(call("show_chart", { ...brazil, transform: "Ratio", per: lifeExpectancy })),
    ])

    return Effect.gen(function* () {
      yield* answer("Life expectancy per life expectancy in Brazil")

      expect(model.prompts[1]).toContain("a ratio must divide by another indicator")
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
        Effect.succeed(call("show_chart", unemployment, { step: "chart-1" })),
        Effect.succeed(
          call(
            "show_chart",
            {
              ...unemployment,
              dimensions: [
                { dimension: "age", code: "Y15-74" },
                { dimension: "unit", code: "PC_ACT" },
                { dimension: "sex", code: "T" },
              ],
            },
            { step: "chart-2" },
          ),
        ),
      ])

      return Effect.gen(function* () {
        const steps = yield* answer("Unemployment in France")

        expect(log(steps)[0]).toMatchObject({
          id: "chart-1",
          state: Rejected.make({
            reason: Rejection.cases.OpenDimensions.make({
              open: [DimensionId.make("age"), DimensionId.make("unit"), DimensionId.make("sex")],
            }),
          }),
        })
        expect(model.prompts[1]).toContain("sex (F Females, M Males, T Total)")
        expect(steps.at(-1)).toEqual(
          charted({
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
      expect(yield* answer("What is the meaning of life?")).toEqual([
        ...thinking(0),
        Unanswered.make({}),
      ])
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

    const read = (state: typeof Definition.Type.state) =>
      Definition.make({
        id: StepId.make("call-describe_indicator"),
        indicator: lifeExpectancy,
        state,
      })

    return Effect.gen(function* () {
      const steps = yield* answer("Life expectancy in Brazil")

      expect(steps.slice(2, 4)).toEqual([
        read(running),
        read(Read.make({ name: "Life expectancy at birth, total (years)" })),
      ])
      expect(model.prompts[1]).toContain("The number of years a newborn infant would live.")
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("searches every source, or one the model names, and reports which each found", () => {
    const model = scripted([
      Effect.succeed(
        call("search_indicators", { text: "unemployment", source: null }, { step: "search-1" }),
      ),
      Effect.succeed(
        call(
          "search_indicators",
          { text: "unemployment", source: "Eurostat" },
          { step: "search-2" },
        ),
      ),
      Effect.succeed(
        call("search_indicators", { text: "happiness", source: null }, { step: "search-3" }),
      ),
      Effect.succeed(words("No indicator measures that.")),
    ])

    const eurostatUnemployment = {
      indicator: IndicatorId.make("ESTAT,UNE_RT_A,1.0"),
      name: "Unemployment by sex and age - annual data",
    }

    return Effect.gen(function* () {
      expect(log(yield* answer("Unemployment in France"))).toEqual([
        Search.make({
          id: StepId.make("search-1"),
          text: "unemployment",
          state: Searched.make({
            count: 2,
            top: [
              eurostatUnemployment,
              {
                indicator: IndicatorId.make("OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0"),
                name: "Monthly unemployment rates",
              },
            ],
          }),
        }),
        Search.make({
          id: StepId.make("search-2"),
          text: "unemployment",
          source: "Eurostat",
          state: Searched.make({ count: 1, top: [eurostatUnemployment] }),
        }),
        Search.make({
          id: StepId.make("search-3"),
          text: "happiness",
          state: Searched.make({ count: 0, top: [] }),
        }),
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
      expect(log(yield* answer("Unemployment in France"))[0]).toEqual(
        Definition.make({
          id: StepId.make("call-describe_indicator"),
          indicator: IndicatorId.make("ESTAT,UNE_RT_A,1.0"),
          state: Read.make({ name: "Unemployment by sex and age - annual data" }),
        }),
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
      expect(log(yield* answer("Unemployment in France"))[0]).toMatchObject({
        state: Rejected.make({ reason: Rejection.cases.NoValues.make({}) }),
      })
      expect(model.prompts[1]).toContain(
        "Eurostat has no annual values for these countries and years. Try other years, or another dataflow if this one is quarterly or monthly only.",
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
    it.effect(`fails the step, then the answer, when ${source} is unreachable`, () => {
      const model = scripted([Effect.succeed(call("describe_indicator", { indicator }))])

      return Effect.gen(function* () {
        const seen: Array<Step> = []

        const error = yield* ask("Unemployment in France").pipe(
          Effect.flatMap(Stream.runForEach((step) => Effect.sync(() => seen.push(step)))),
          Effect.flip,
        )

        expect(error).toEqual(new SourceUnavailable({ source }))
        expect(seen.at(-1)).toMatchObject({
          indicator,
          state: Failed.make({ reason: new SourceUnavailable({ source }) }),
        })
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
      expect(log(yield* answer("Life expectancy in Ivory Coast and Korea"))[0]).toEqual(
        Lookup.make({
          id: StepId.make("call-find_countries"),
          names: ["Ivory Coast", "Korea"],
          state: Located.make({
            places: [
              { name: "Ivory Coast", countries: ["CIV"] },
              { name: "Korea", countries: ["KOR", "PRK"] },
            ],
          }),
        }),
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
      expect(log(yield* answer("How long do people live in Brazil?"))).toEqual([asked])

      expect((yield* answer("Life expectancy")).at(-1)).toEqual(
        charted({ view: brazilTrend, takeaway }),
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
            answer: charted({ view: brazilTrend, takeaway }),
            steps: [fetched(), wrote()],
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
      const seen: Array<Step> = []

      const error = yield* ask("Life expectancy in Brazil").pipe(
        Effect.flatMap(Stream.runForEach((step) => Effect.sync(() => seen.push(step)))),
        Effect.flip,
      )

      expect(error).toBeInstanceOf(AgentUnavailable)
      expect(seen).toEqual([
        thinking(0)[0],
        Thinking.make({
          id: StepId.make("thinking-0"),
          state: Failed.make({ reason: new AgentUnavailable() }),
        }),
      ])
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

        expect((yield* Fiber.join(first)).at(-1)).toEqual(charted({ view: brazilTrend, takeaway }))
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

      const answered = charted({ view: brazilTrend, takeaway })

      return yield* Effect.gen(function* () {
        // The visitor reads the first step, then closes the tab.
        expect(
          yield* ask("Life expectancy in Brazil").pipe(Effect.flatMap(Stream.runHead)),
        ).toEqual(Option.some(thinking(0)[0]))

        expect(yield* turns).toEqual({
          answered: [],
          answering: { question: "Life expectancy in Brazil", started: DateTime.makeUnsafe(0) },
        })

        // Coming back, they follow the answer from its first step.
        const following = yield* follow

        yield* Deferred.succeed(reply, call("show_chart", brazil))

        expect(log(yield* Stream.runCollect(following))).toEqual([
          searched(),
          fetched(),
          wrote(),
          answered,
        ])
        expect(yield* turns).toEqual({
          answered: [
            {
              question: "Life expectancy in Brazil",
              answer: answered,
              steps: [searched(), fetched(), wrote()],
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
        steps: [searched()],
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

        // The model was thinking: that step ends as stopped, then the answer.
        expect((yield* Fiber.join(steps)).slice(-2)).toEqual([
          Thinking.make({ id: StepId.make("thinking-1"), state: Stopped.make({}) }),
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

  it.effect("stops the step running when the answer stops, and keeps it as stopped", () =>
    Effect.gen(function* () {
      const seen = yield* Deferred.make<void>()

      // A World Bank that never answers a definition.
      const slow = Layer.succeed(
        WorldBank,
        WorldBank.of({
          describe: () => Effect.never,
          observations: () => Effect.die("no observations in this test"),
          indicators: Effect.succeed([]),
        }),
      )

      const model = scripted([
        Effect.succeed(call("describe_indicator", { indicator: lifeExpectancy })),
      ])

      const read = Definition.make({
        id: StepId.make("call-describe_indicator"),
        indicator: lifeExpectancy,
        state: Stopped.make({}),
      })

      return yield* Effect.gen(function* () {
        const steps = yield* ask("Life expectancy in Brazil").pipe(
          Effect.flatMap((stream) =>
            stream.pipe(
              Stream.tap((step) =>
                isDefinition(step) ? Deferred.succeed(seen, undefined) : Effect.void,
              ),
              Stream.runCollect,
            ),
          ),
          Effect.forkChild,
        )

        // The visitor sees the agent reading the definition, and stops it.
        yield* Deferred.await(seen)
        yield* stop

        expect((yield* Fiber.join(steps)).slice(-2)).toEqual([read, Stopped.make({})])
        expect((yield* turns).answered[0]?.steps).toEqual([read])
      }).pipe(Effect.provide(serveApi(model.layer, { worldBank: slow })))
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
            answer: charted({ view: brazilTrend, takeaway }),
            steps: [fetched(), wrote()],
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
              answer: charted({ view: brazilTrend, takeaway }),
              steps: [
                searched(),
                Definition.make({
                  id: StepId.make("call-describe_indicator"),
                  indicator: lifeExpectancy,
                  state: Read.make({ name: "Life expectancy at birth, total (years)" }),
                }),
                fetched(),
                wrote(),
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

  it.effect("reads turns saved before steps had states as they were saved", () => {
    // A turn as the transcript held it then.
    const turn = `{
      "question": "Life expectancy in Brazil",
      "answer": { "_tag": "Unanswered" },
      "steps": [
        { "_tag": "Searched", "text": "life expectancy", "found": ["World Bank"] },
        { "_tag": "Described", "indicator": "SP.DYN.LE00.IN" },
        { "_tag": "Located", "names": ["Ivory Coast"] },
        { "_tag": "Rejected", "problem": "The World Bank has no values for these years." }
      ],
      "took": 4000
    }`

    const { fake } = memoryStorage(
      new Map([["conversation", `{ "chat": "[]", "turns": [${turn}] }`]]),
    )

    const sent = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
      `{ "answered": [${turn}] }`,
    )

    return Effect.gen(function* () {
      expect(encodeTurns(yield* turns)).toEqual(sent)
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

// The charts the model was told are on screen in a prompt, each with its
// place in the answer and as show_chart's arguments, each time it was told.
const onScreen = (prompt: string) =>
  [
    ...prompt
      .replaceAll(String.raw`\"`, '"')
      .matchAll(/Chart (\d+) is now show_chart (\{.*?\})\./g),
  ].map(([, place, json]) => ({ chart: Number(place), draft: JSON.parse(json ?? "null") }))

// A model that answers `count` questions, each with a chart and its takeaway.
const charts = (count: number) =>
  scripted(
    Array.from({ length: count }, () => [
      Effect.succeed(call("show_chart", brazil)),
      Effect.succeed(words(takeaway)),
      done,
    ]).flat(),
  )

describe("changing a chart", () => {
  const perPerson = Trend.make({ ...brazilTrend, transform: "PerPerson" })

  it.effect("keeps the changed chart with its turn, and changes it back", () => {
    const model = charts(1)

    return Effect.gen(function* () {
      yield* answer("Life expectancy in Brazil")
      yield* show(0, perPerson)

      expect((yield* turns).answered[0]?.shown).toEqual([perPerson])

      yield* show(0, brazilTrend)

      expect((yield* turns).answered[0]).not.toHaveProperty("shown")
      expect((yield* turns).answered[0]?.answer).toEqual(charted({ view: brazilTrend, takeaway }))
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("keeps a changed chart in the conversation's storage", () => {
    const model = charts(1)
    const { fake } = memoryStorage()

    return Effect.gen(function* () {
      yield* answer("Life expectancy in Brazil").pipe(
        Effect.provide(serveApi(model.layer, { storage: fake })),
      )
      yield* show(0, perPerson).pipe(Effect.provide(serveApi(model.layer, { storage: fake })))

      // A new process reads the same storage, as after a reload.
      expect(
        (yield* turns.pipe(Effect.provide(serveApi(model.layer, { storage: fake })))).answered[0]
          ?.shown,
      ).toEqual([perPerson])
    })
  })

  it.effect("fails with TurnNotFound for a turn the conversation does not have", () => {
    const model = charts(1)

    return Effect.gen(function* () {
      expect(yield* show(0, perPerson).pipe(Effect.flip)).toEqual(new TurnNotFound({ turn: 0 }))

      yield* answer("Life expectancy in Brazil")

      expect(yield* show(1, perPerson).pipe(Effect.flip)).toEqual(new TurnNotFound({ turn: 1 }))
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("fails with NoChart for a turn that did not end with a chart", () => {
    const model = scripted([Effect.succeed(words("No World Bank indicator measures that."))])

    return Effect.gen(function* () {
      yield* answer("What is the meaning of life?")

      expect(yield* show(0, perPerson).pipe(Effect.flip)).toEqual(
        new NoChart({ turn: 0, chart: 0 }),
      )
      expect((yield* turns).answered[0]).not.toHaveProperty("shown")
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("tells the model about a changed chart with the next question only", () => {
    const model = charts(3)

    return Effect.gen(function* () {
      yield* answer("Life expectancy in Brazil")
      yield* show(0, perPerson)
      yield* answer("Add Mexico")

      // The note leads the question's own message.
      expect(onScreen(model.prompts[3] ?? "")).toEqual([
        { chart: 1, draft: { ...brazil, transform: "PerPerson" } },
      ])
      expect(model.prompts[3]).toContain(String.raw`\n\nAdd Mexico`)

      // The answer to "Add Mexico" is newer than the change: the next
      // question builds on it, and the chat holds the one note it had.
      yield* answer("Now as a ranking")

      expect(onScreen(model.prompts[6] ?? "")).toHaveLength(1)
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("sends no note when no chart changed, or one changed back", () => {
    const model = charts(3)

    return Effect.gen(function* () {
      yield* answer("Life expectancy in Brazil")
      yield* answer("Add Mexico")
      yield* show(1, perPerson)
      yield* show(1, brazilTrend)
      yield* answer("Now as a ranking")

      expect(model.prompts.flatMap(onScreen)).toEqual([])
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("tells the model about a chart changed while it asked back", () =>
    Effect.gen(function* () {
      const reply = yield* Deferred.make<ReadonlyArray<Response.PartEncoded>>()
      const deciding = yield* Deferred.make<void>()

      const model = scripted([
        Effect.succeed(call("show_chart", brazil)),
        Effect.succeed(words(takeaway)),
        done,
        Deferred.succeed(deciding, undefined).pipe(Effect.andThen(Deferred.await(reply))),
        Effect.succeed(call("show_chart", brazil)),
      ])

      return yield* Effect.gen(function* () {
        yield* answer("Life expectancy in Brazil")

        const second = yield* answer("Compare it").pipe(Effect.forkChild)

        yield* Deferred.await(deciding)
        yield* show(0, perPerson)
        yield* Deferred.succeed(
          reply,
          call("ask_user", { question: "With which countries?", choices: ["Mexico", "Chile"] }),
        )
        yield* Fiber.join(second)
        yield* answer("Mexico")

        expect(onScreen(model.prompts.at(-2) ?? "")).toEqual([
          { chart: 1, draft: { ...brazil, transform: "PerPerson" } },
        ])
      }).pipe(Effect.provide(serveApi(model.layer)))
    }),
  )

  it.effect("keeps a chart changed while an answer runs, without disturbing it", () =>
    Effect.gen(function* () {
      const reply = yield* Deferred.make<ReadonlyArray<Response.PartEncoded>>()
      const deciding = yield* Deferred.make<void>()

      const model = scripted([
        Effect.succeed(call("show_chart", brazil)),
        Effect.succeed(words(takeaway)),
        done,
        Deferred.succeed(deciding, undefined).pipe(Effect.andThen(Deferred.await(reply))),
      ])

      return yield* Effect.gen(function* () {
        yield* answer("Life expectancy in Brazil")

        const second = yield* answer("Add Mexico").pipe(Effect.forkChild)

        // The model is deciding how to answer "Add Mexico".
        yield* Deferred.await(deciding)
        yield* show(0, perPerson)
        yield* Deferred.succeed(reply, call("show_chart", { ...brazil, countries: ["BRA", "MEX"] }))

        const mexico = Trend.make({ ...brazilTrend, countries: ["BRA", "MEX"] })

        expect((yield* Fiber.join(second)).at(-1)).toEqual(charted({ view: mexico, takeaway }))

        const [first, last] = (yield* turns).answered

        expect(first?.shown).toEqual([perPerson])
        expect(last?.answer).toEqual(charted({ view: mexico, takeaway }))
      }).pipe(Effect.provide(serveApi(model.layer)))
    }),
  )
})

// A View as JSON, as storage keeps it.
const encode = (view: View) => JSON.stringify(Schema.encodeSync(View)(view))

describe("several charts", () => {
  const change = { ...brazil, chart: "change" }

  const brazilChange = Change.make({
    indicator: lifeExpectancy,
    countries: ["BRA"],
    from: Year.make(2000),
    to: Year.make(2002),
  })

  const rose = "Life expectancy in Brazil rose from 70 years in 2000 to 72 in 2002."

  it.effect("answers with a chart and its checked takeaway for each part of the question", () => {
    const model = scripted([
      Effect.succeed(call("show_chart", brazil, { step: "chart-1" })),
      Effect.succeed(words(takeaway)),
      Effect.succeed(call("show_chart", change, { step: "chart-2" })),
      Effect.succeed(words(rose)),
      done,
    ])

    const answered = charted(
      { view: brazilTrend, takeaway },
      { view: brazilChange, takeaway: rose },
    )

    return Effect.gen(function* () {
      expect(
        log(yield* answer("How has life expectancy moved in Brazil, and by how much?")),
      ).toEqual([
        fetched(undefined, { step: "chart-1" }),
        wrote(),
        // A change reads its two years only.
        fetched(Fetched.make({ values: 2 }), { step: "chart-2", view: brazilChange }),
        // 70, 2000, 72 and 2002, checked against the change's own values.
        wrote(Checked.make({ numbers: 4 }), { chart: 1 }),
        answered,
      ])
      expect((yield* turns).answered[0]?.answer).toEqual(answered)
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("ends the answer after its third chart", () => {
    const model = scripted([
      Effect.succeed(call("show_chart", brazil, { step: "chart-1" })),
      Effect.succeed(words(takeaway)),
      Effect.succeed(call("show_chart", change, { step: "chart-2" })),
      Effect.succeed(words(takeaway)),
      Effect.succeed(call("show_chart", { ...brazil, countries: ["MEX"] }, { step: "chart-3" })),
      Effect.succeed(words("Life expectancy rose in Mexico.")),
      Effect.die("the model must not be asked for a fourth chart"),
    ])

    return Effect.gen(function* () {
      const ending = (yield* answer("Life expectancy in Brazil and Mexico, three ways")).at(-1)

      expect(ending).toEqual(
        charted(
          { view: brazilTrend, takeaway },
          { view: brazilChange, takeaway },
          {
            view: Trend.make({ ...brazilTrend, countries: ["MEX"] }),
            takeaway: "Life expectancy rose in Mexico.",
          },
        ),
      )
      expect(model.prompts).toHaveLength(6)
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("drops only the takeaway that fails the check", () => {
    const model = scripted([
      Effect.succeed(call("show_chart", brazil, { step: "chart-1" })),
      // 72 - 70, worked out by the model.
      Effect.succeed(words("Life expectancy in Brazil rose by 2 years.")),
      Effect.succeed(call("show_chart", change, { step: "chart-2" })),
      Effect.succeed(words(rose)),
      done,
    ])

    return Effect.gen(function* () {
      const steps = log(yield* answer("Life expectancy in Brazil, and its change"))

      expect(steps.filter(Schema.is(Takeaway))).toEqual([
        wrote(Dropped.make({})),
        wrote(Checked.make({ numbers: 4 }), { chart: 1 }),
      ])
      expect(steps.at(-1)).toEqual(
        charted({ view: brazilTrend }, { view: brazilChange, takeaway: rose }),
      )
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("draws one chart a round, so each takeaway comes before the next chart", () => {
    const both: ReadonlyArray<Response.PartEncoded> = [
      { type: "tool-call", id: "chart-1", name: "show_chart", params: brazil },
      { type: "tool-call", id: "chart-2", name: "show_chart", params: change },
      finish,
    ]

    const model = scripted([
      Effect.succeed(both),
      Effect.succeed(words(takeaway)),
      Effect.succeed(call("show_chart", change, { step: "chart-3" })),
      Effect.succeed(words(rose)),
      done,
    ])

    return Effect.gen(function* () {
      const steps = log(yield* answer("Life expectancy in Brazil, and its change"))

      // The chart refused is the model's to draw again, not a step.
      expect(steps.filter(Schema.is(Fetch)).map((step) => step.id)).toEqual(["chart-1", "chart-3"])
      expect(model.prompts[1]).toContain("Show one chart at a time.")
      expect(steps.at(-1)).toEqual(
        charted({ view: brazilTrend, takeaway }, { view: brazilChange, takeaway: rose }),
      )
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("tells the model which chart a person changed, by its place in the answer", () => {
    const model = scripted([
      Effect.succeed(call("show_chart", brazil, { step: "chart-1" })),
      Effect.succeed(words(takeaway)),
      Effect.succeed(call("show_chart", change, { step: "chart-2" })),
      Effect.succeed(words(rose)),
      done,
    ])

    const perPerson = Change.make({ ...brazilChange, transform: "PerPerson" })

    return Effect.gen(function* () {
      yield* answer("Life expectancy in Brazil, and its change")
      yield* show(0, perPerson, { chart: 1 })

      expect((yield* turns).answered[0]?.shown).toEqual([null, perPerson])

      yield* answer("Add Mexico")

      expect(onScreen(model.prompts[5] ?? "")).toEqual([
        { chart: 2, draft: { ...change, transform: "PerPerson" } },
      ])
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("fails with NoChart for a place the answer has no chart at", () => {
    const model = charts(1)

    return Effect.gen(function* () {
      yield* answer("Life expectancy in Brazil")

      expect(yield* show(0, brazilTrend, { chart: 1 }).pipe(Effect.flip)).toEqual(
        new NoChart({ turn: 0, chart: 1 }),
      )
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect(
    "loads turns saved when answers held one chart, and the chart a person changed it to",
    () => {
      const model = scripted([])
      const perPerson = Trend.make({ ...brazilTrend, transform: "PerPerson" })

      // As conversations were stored before answers held several charts.
      const stored = new Map([
        [
          "conversation",
          `{
            "chat": "[]",
            "turns": [
              {
                "question": "Life expectancy in Brazil",
                "answer": { "_tag": "Answered", "view": ${encode(brazilTrend)}, "takeaway": "${takeaway}" },
                "shown": ${encode(perPerson)}
              },
              {
                "question": "Life expectancy in Brazil again",
                "answer": { "_tag": "Answered", "view": ${encode(brazilTrend)} }
              }
            ],
            "changed": 0
          }`,
        ],
      ])

      return Effect.gen(function* () {
        expect((yield* turns).answered).toEqual([
          {
            question: "Life expectancy in Brazil",
            answer: charted({ view: brazilTrend, takeaway }),
            shown: [perPerson],
          },
          { question: "Life expectancy in Brazil again", answer: charted({ view: brazilTrend }) },
        ])
      }).pipe(Effect.provide(serveApi(model.layer, { storage: memoryStorage(stored).fake })))
    },
  )
})

// The first chart of an answer, once its takeaway is written.
const firstWritten = (step: Step) =>
  isDrawn(step) && step.id === "drawn-0" && Predicate.isTagged(step.state, "Done")

describe("charts as they are drawn", () => {
  const change = { ...brazil, chart: "change" }

  const brazilChange = Change.make({
    indicator: lifeExpectancy,
    countries: ["BRA"],
    from: Year.make(2000),
    to: Year.make(2002),
  })

  const isFetch = Schema.is(Fetch)

  // A model that draws a chart, writes its takeaway, then waits on `next`
  // before it draws the second.
  const twoCharts = (next: Deferred.Deferred<ReadonlyArray<Response.PartEncoded>>) =>
    scripted([
      Effect.succeed(call("show_chart", brazil, { step: "chart-1" })),
      Effect.succeed(words(takeaway)),
      Deferred.await(next),
      Effect.succeed(words(takeaway)),
      done,
    ])

  it.effect("sends the first chart and its takeaway before the second is fetched", () =>
    Effect.gen(function* () {
      const next = yield* Deferred.make<ReadonlyArray<Response.PartEncoded>>()
      const model = twoCharts(next)

      return yield* Effect.gen(function* () {
        const first = yield* ask("Life expectancy in Brazil, and its change").pipe(
          Effect.flatMap((steps) => steps.pipe(Stream.takeUntil(firstWritten), Stream.runCollect)),
        )

        expect(first.filter(isDrawn)).toEqual([drew(running), drew(Explained.make({ takeaway }))])
        expect(first.filter(isFetch).map((step) => step.id)).not.toContain("chart-2")

        const following = yield* follow

        yield* Deferred.succeed(next, call("show_chart", change, { step: "chart-2" }))

        expect((yield* Stream.runCollect(following)).at(-1)).toEqual(
          charted({ view: brazilTrend, takeaway }, { view: brazilChange, takeaway }),
        )
      }).pipe(Effect.provide(serveApi(model.layer)))
    }),
  )

  it.effect("sends a follower who joins late the charts drawn so far", () =>
    Effect.gen(function* () {
      const next = yield* Deferred.make<ReadonlyArray<Response.PartEncoded>>()
      const model = twoCharts(next)

      return yield* Effect.gen(function* () {
        // The visitor sees the first chart, then closes the tab.
        yield* ask("Life expectancy in Brazil, and its change").pipe(
          Effect.flatMap((steps) => steps.pipe(Stream.takeUntil(firstWritten), Stream.runDrain)),
        )

        const following = yield* follow

        yield* Deferred.succeed(next, call("show_chart", change, { step: "chart-2" }))

        expect((yield* Stream.runCollect(following)).reduce(put<Step>, []).filter(isDrawn)).toEqual(
          [
            drew(Explained.make({ takeaway })),
            drew(Explained.make({ takeaway }), { chart: 1, view: brazilChange }),
          ],
        )
      }).pipe(Effect.provide(serveApi(model.layer)))
    }),
  )

  it.effect("keeps the charts drawn before a stop, with their takeaways", () => {
    // The model decides on a second chart until the stop.
    const model = scripted([
      Effect.succeed(call("show_chart", brazil)),
      Effect.succeed(words(takeaway)),
      Effect.never,
    ])

    const stopped = Stopped.make({ charts: [{ view: brazilTrend, takeaway }] })

    return Effect.gen(function* () {
      // The person sees the first chart, then stops the answer.
      yield* ask("Life expectancy in Brazil, and its change").pipe(
        Effect.flatMap((steps) => steps.pipe(Stream.takeUntil(firstWritten), Stream.runDrain)),
      )

      const following = yield* follow

      yield* stop

      expect((yield* Stream.runCollect(following)).at(-1)).toEqual(stopped)
      expect((yield* turns).answered[0]?.answer).toEqual(stopped)
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("keeps a chart stopped while its takeaway was written, without one", () => {
    const model = scripted([Effect.succeed(call("show_chart", brazil)), Effect.never])

    return Effect.gen(function* () {
      yield* ask("Life expectancy in Brazil").pipe(
        Effect.flatMap((steps) => steps.pipe(Stream.takeUntil(isDrawn), Stream.runDrain)),
      )

      const following = yield* follow

      yield* stop

      expect((yield* Stream.runCollect(following)).slice(-2)).toEqual([
        drew(Halted.make({})),
        Stopped.make({ charts: [{ view: brazilTrend }] }),
      ])
      expect((yield* turns).answered[0]?.answer).toEqual(
        Stopped.make({ charts: [{ view: brazilTrend }] }),
      )
    }).pipe(Effect.provide(serveApi(model.layer)))
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
      expect(yield* explain(brazilTrend)).toEqual({ view: brazilTrend, takeaway: written })
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
