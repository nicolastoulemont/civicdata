import {
  AgentUnavailable,
  Answered,
  Api,
  Asked,
  type Block,
  Change,
  Chart,
  ChartIndex,
  ConversationBusy,
  type Country,
  countries as economies,
  ConversationId,
  Coverage,
  Covered,
  Definition,
  DimensionId,
  Evidence,
  Finding,
  Dimensions,
  Failed,
  Fetch,
  Fetched,
  IndicatorId,
  IndicatorNotFound,
  Located,
  Lookup,
  NoChart,
  PoliticsUnavailable,
  put,
  Ranking,
  Read,
  RecordId,
  Relation,
  Recorded,
  Records,
  Rejected,
  Rejection,
  Rendered,
  Research,
  Researched,
  Running,
  Scope,
  Search,
  Searched,
  sourceOf,
  SourceUnavailable,
  type Step,
  StepId,
  type Study,
  Stopped,
  Text,
  Thinking,
  Thought,
  TooManyQuestions,
  Trend,
  TurnIndex,
  TurnNotFound,
  Unanswered,
  Unresolved,
  View,
  Year,
} from "@civicdata/domain"
import { beforeEach, describe, expect, it } from "@effect/vitest"
import {
  Array as Arr,
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
  Struct,
} from "effect"
import { AiError, LanguageModel, type Response } from "effect/ai"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiTest } from "effect/http-api"
import { TestClock } from "effect/testing"
import { strToU8, zipSync } from "fflate"

import { Agent } from "../src/Agent.ts"
import { AskLimit } from "../src/AskLimit.ts"
import { Catalog } from "../src/Catalog.ts"
import { serve } from "../src/ConversationObject.ts"
import { Conversations } from "../src/Conversations.ts"
import { Findings } from "../src/Findings.ts"
import { Handlers } from "../src/Handlers.ts"
import { Notes } from "../src/Notes.ts"
import { Politics } from "../src/Politics.ts"
import { Resolver } from "../src/Resolver.ts"
import { Sdmx } from "../src/Sdmx.ts"
import { type Storage, Transcript } from "../src/Transcript.ts"
import { WorldBank } from "../src/WorldBank.ts"
import { http, memory, memoryStorage } from "./fakes.ts"
import participationFlow from "./fixtures/eurostat/participation-flow.json"
import participationOptions from "./fixtures/eurostat/participation-options.csv?raw"
import participation from "./fixtures/eurostat/participation.csv?raw"
import unemploymentEsms from "./fixtures/eurostat/unemployment-esms.sdmx.xml?raw"
import unemploymentFlow from "./fixtures/eurostat/unemployment-flow.json"
import unemploymentOptions from "./fixtures/eurostat/unemployment-options.csv?raw"
import unemploymentRates from "./fixtures/eurostat/unemployment-total.csv?raw"
import { build, emptyPolitics, politicsOver, recorded as archived } from "./politics.ts"

const lifeExpectancy = IndicatorId.make("SP.DYN.LE00.IN")
const gdpPerPerson = IndicatorId.make("NY.GDP.PCAP.CD")

// The World Bank's names for the indicators it publishes here.
const named = new Map([
  [lifeExpectancy, "Life expectancy at birth, total (years)"],
  [gdpPerPerson, "GDP per capita (current US$)"],
])

const id = ConversationId.make("0b5d7c1e-8f4a-4c2b-9d3e-1a2b3c4d5e6f")

// A World Bank that publishes life expectancy and GDP per person for Brazil,
// Mexico and Spain, 2000 to 2002.
const recordedWorldBank = Layer.succeed(
  WorldBank,
  WorldBank.of({
    describe: (indicator) => {
      const name = named.get(indicator)

      return name === undefined
        ? Effect.fail(new IndicatorNotFound({ indicator }))
        : Effect.succeed({
            indicator: {
              id: indicator,
              name,
              definition: "The number of years a newborn infant would live.",
            },
            dataset: "World Development Indicators",
            retrievedAt: DateTime.makeUnsafe("2026-11-01T00:00:00Z"),
          })
    },
    observations: (query) =>
      Effect.succeed({
        observations: (["BRA", "MEX", "ESP"] as const).flatMap((country) =>
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
    version: Effect.die("not used by conversations"),
    series: () => Effect.die("not used by conversations"),
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
  | "find_politics"
  | "find_research"
  | "find_years"
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
  span_from: null,
  span_to: null,
  transform: null,
  per: null,
  dimensions: null,
  overlays: null,
}

const words = (text: string): ReadonlyArray<Response.PartEncoded> => [
  { type: "text", text },
  finish,
]

// Words, then tool calls, in one round: the model writes and goes on.
const saying = (text: string, parts: ReadonlyArray<Response.PartEncoded>) => [
  { type: "text", text } as const,
  ...parts,
]

type Turn = Effect.Effect<ReadonlyArray<Response.PartEncoded>, AiError.AiError>

// What the model writes once it has shown a chart, unless a test scripts it.
// Words alone end the answer.
const takeaway = "Life expectancy rose in Brazil."

// The model stops without a word or a tool call.
const silent = Effect.succeed([finish])

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

// Eurostat's notes on unemployment, as recorded on 2026-11-10: the dataflow
// links its ESMS file, zipped.
const recordedNotes = Notes.layer.pipe(
  Layer.provide(
    http(
      (url) =>
        new Map([
          [
            `${eurostat}/sdmx/2.1/dataflow/ESTAT/UNE_RT_A/1.0?format=JSON`,
            globalThis.Response.json(unemploymentFlow),
          ],
          [
            `${eurostat}/files?file=metadata/lfsi_esms.sdmx.zip`,
            new globalThis.Response(zipSync({ "lfsi_esms.sdmx.xml": strToU8(unemploymentEsms) })),
          ],
        ]).get(url) ?? new globalThis.Response("no recording", { status: 404 }),
    ),
  ),
  Layer.provide(memory().layer),
)

interface ServeOptions {
  readonly limit?: Layer.Layer<AskLimit>
  // The sources, when a test needs one to fail.
  readonly worldBank?: Layer.Layer<WorldBank>
  readonly sdmx?: Layer.Layer<Sdmx>
  // The political records. Without them, none are available.
  readonly politics?: Layer.Layer<Politics>
  // The research findings. Without them, there are none.
  readonly findings?: Layer.Layer<Findings>
  readonly notes?: Layer.Layer<Notes>
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
    politics = Politics.unavailable,
    findings = Findings.holding([]),
    notes = recordedNotes,
  }: ServeOptions = {},
) => {
  const agent = Agent.layer.pipe(
    Layer.provide(model),
    Layer.provide(findings),
    Layer.provide(notes),
    Layer.provide(Resolver.layer),
    Layer.provide(catalog),
    Layer.provide(politics),
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
            Layer.provide(politics),
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

// An answer of these blocks, in order.
const charted = (...blocks: Arr.NonEmptyReadonlyArray<Block>) => Answered.make({ blocks })

const chart = (view: View) => Chart.make({ view })

// What the model wrote, the takeaway unless a test names other words.
const said = (text = takeaway) => Text.make({ text })

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

// Brazil, Mexico and Spain, which have values, then other countries in the
// domain's order: `count` in all.
const many = (count: number): Arr.NonEmptyReadonlyArray<Country> => [
  "BRA",
  ...economies
    .map(({ code }) => code)
    .filter((code) => code !== "BRA")
    .slice(0, count - 1),
]

// Charts of many countries, and of few: each is drawn.
const drawn = [
  {
    name: "a trend of 10 countries",
    args: { countries: many(10) },
    view: Trend.make({ ...brazilTrend, countries: many(10) }),
  },
  {
    name: "a ranking of 60 countries",
    args: { chart: "ranking", countries: many(60), from: null, to: null, year: 2002 },
    view: Ranking.make({ indicator: lifeExpectancy, countries: many(60), year: Year.make(2002) }),
  },
  {
    name: "a map of 3 countries",
    args: { chart: "map", countries: many(3), from: null, to: null, year: 2002 },
    view: Ranking.make({
      indicator: lifeExpectancy,
      countries: many(3),
      year: Year.make(2002),
      as: "Map",
    }),
  },
  {
    name: "a relation of 3 countries",
    args: {
      chart: "relation",
      against: gdpPerPerson,
      countries: many(3),
      from: null,
      to: null,
      year: 2002,
    },
    view: Relation.make({
      indicator: lifeExpectancy,
      against: gdpPerPerson,
      countries: many(3),
      year: Year.make(2002),
    }),
  },
]

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

// The block at `place` in the answer, sent as soon as the round that wrote
// it ends.
const rendered = (block: Block, place: number) =>
  Rendered.make({ id: StepId.make(`block-${place}`), block })

const isThinking = Schema.is(Thinking)
const isRendered = Schema.is(Rendered)

// The work log: each step as it last was, in the order they started, without
// the model's thinking or the blocks sent.
const log = (steps: ReadonlyArray<Step>) =>
  steps.reduce(put<Step>, []).filter((step) => !isThinking(step) && !isRendered(step))

describe("conversations", () => {
  it.effect("streams the steps of an answer and keeps the question with its chart", () => {
    const model = scripted([
      Effect.succeed(call("search_indicators", { text: "life expectancy", source: null })),
      Effect.succeed(call("show_chart", brazil)),
    ])

    return Effect.gen(function* () {
      expect(yield* turns).toEqual({ answered: [] })

      // Each round thinks before its tools, and each tool reports running,
      // then done with what it found. Each block goes out once its round
      // ends, and a round of words alone ends the answer.
      expect(yield* answer("How has life expectancy changed in Brazil?")).toEqual([
        ...thinking(0),
        searched(running),
        searched(),
        ...thinking(1),
        fetched(running),
        fetched(),
        rendered(chart(brazilTrend), 0),
        ...thinking(2),
        rendered(said(), 1),
        charted(chart(brazilTrend), said()),
      ])

      expect(yield* turns).toEqual({
        answered: [
          {
            question: "How has life expectancy changed in Brazil?",
            answer: charted(chart(brazilTrend), said()),
            steps: [searched(), fetched()],
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
        charted(chart(Trend.make({ ...brazilTrend, countries: ["BRA", "MEX"] })), said()),
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

      expect(last).toContain("You answer a question about countries")
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
        charted(chart(brazilTrend), said()),
      ])
      expect(model.prompts[1]).toContain("LCN")
      expect(model.prompts[2]).toContain(
        "The World Bank has no values for these countries and years. Try other years.",
      )
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("writes about a chart from a summary of the charted values", () => {
    const model = scripted([
      Effect.succeed(call("show_chart", brazil)),
      Effect.succeed(words("  Life expectancy in Brazil rose every year.  ")),
    ])

    const answered = charted(chart(brazilTrend), said("Life expectancy in Brazil rose every year."))

    return Effect.gen(function* () {
      expect((yield* answer("Life expectancy in Brazil")).at(-1)).toEqual(answered)
      // Brazil's line runs from 70 in 2000 to 72 in 2002.
      expect(model.prompts[1]).toContain(
        '"first":{"year":2000,"value":70},"last":{"year":2002,"value":72}',
      )
      expect((yield* turns).answered[0]?.answer).toEqual(answered)
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("shows what the model writes around its charts, in order, numbers and all", () => {
    const model = scripted([
      Effect.succeed([{ type: "text", text: "Brazil first." }, ...call("show_chart", brazil)]),
      // 72 - 70, worked out by the model.
      Effect.succeed(words("Life expectancy in Brazil rose by 2 years.")),
    ])

    const answered = charted(
      said("Brazil first."),
      chart(brazilTrend),
      said("Life expectancy in Brazil rose by 2 years."),
    )

    return Effect.gen(function* () {
      const steps = yield* answer("Life expectancy in Brazil")

      expect(steps.filter(isRendered)).toEqual(answered.blocks.map(rendered))
      expect(steps.at(-1)).toEqual(answered)
      expect((yield* turns).answered[0]?.answer).toEqual(answered)
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  // "Since 2000": the instructions give the model the current year, so it
  // asks for every year up to it, past the World Bank's latest data.
  it.effect("ends a trend at the latest year with data", () => {
    const model = scripted([Effect.succeed(call("show_chart", { ...brazil, to: 2026 }))])

    return Effect.gen(function* () {
      expect((yield* answer("Life expectancy in Brazil since 2000")).at(-1)).toEqual(
        charted(chart(brazilTrend), said()),
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
          charted(
            chart(
              Change.make({
                indicator: lifeExpectancy,
                countries: ["BRA"],
                from: Year.make(2000),
                to: Year.make(2002),
              }),
            ),
            said(),
          ),
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
        charted(
          chart(
            Ranking.make({
              indicator: lifeExpectancy,
              countries: latinAmerica,
              year: Year.make(2002),
              as: "Map",
            }),
          ),
          said(),
        ),
      )
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("answers with a map over time, telling the model the values at its span's ends", () => {
    const model = scripted([
      Effect.succeed(
        call("show_chart", {
          ...brazil,
          chart: "map",
          countries: latinAmerica,
          from: null,
          to: null,
          year: 2002,
          span_from: 2000,
          span_to: 2002,
        }),
      ),
    ])

    return Effect.gen(function* () {
      const steps = yield* answer("How has the map of life expectancy in Latin America changed?")

      expect(steps.at(-1)).toEqual(
        charted(
          chart(
            Ranking.make({
              indicator: lifeExpectancy,
              countries: latinAmerica,
              year: Year.make(2002),
              span: { from: Year.make(2000), to: Year.make(2002) },
              as: "Map",
            }),
          ),
          said(),
        ),
      )
      expect(model.prompts[1]).toContain(
        JSON.stringify({
          from: {
            year: 2000,
            bars: [
              { country: "BRA", value: 70 },
              { country: "MEX", value: 70 },
            ],
          },
          to: {
            year: 2002,
            bars: [
              { country: "BRA", value: 72 },
              { country: "MEX", value: 72 },
            ],
          },
        }),
      )
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect(
    "answers with a relation over time, telling the model the dots at its span's ends",
    () => {
      const model = scripted([
        Effect.succeed(
          call("show_chart", {
            ...brazil,
            chart: "relation",
            against: gdpPerPerson,
            countries: ["BRA", "MEX"],
            from: null,
            to: null,
            year: 2002,
            span_from: 2000,
            span_to: 2002,
          }),
        ),
      ])

      return Effect.gen(function* () {
        const steps = yield* answer("How have income and life expectancy moved together?")

        expect(steps.at(-1)).toEqual(
          charted(
            chart(
              Relation.make({
                indicator: lifeExpectancy,
                against: gdpPerPerson,
                countries: ["BRA", "MEX"],
                year: Year.make(2002),
                span: { from: Year.make(2000), to: Year.make(2002) },
              }),
            ),
            said(),
          ),
        )
        expect(model.prompts[1]).toContain(
          JSON.stringify({
            from: {
              year: 2000,
              dots: [
                { country: "BRA", value: 70, against: 70 },
                { country: "MEX", value: 70, against: 70 },
              ],
            },
            to: {
              year: 2002,
              dots: [
                { country: "BRA", value: 72, against: 72 },
                { country: "MEX", value: 72, against: 72 },
              ],
            },
          }),
        )
      }).pipe(Effect.provide(serveApi(model.layer)))
    },
  )

  it.effect("rejects a span on a trend, then draws the trend", () => {
    const model = scripted([
      Effect.succeed(
        call("show_chart", { ...brazil, span_from: 2000, span_to: 2002 }, { step: "chart-1" }),
      ),
      Effect.succeed(call("show_chart", brazil, { step: "chart-2" })),
    ])

    return Effect.gen(function* () {
      const steps = yield* answer("Life expectancy in Brazil since 2000")

      expect(model.prompts[1]).toContain("span")
      expect(steps.at(-1)).toEqual(charted(chart(brazilTrend), said()))
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("rejects a ranking over time whose year lies outside its span", () => {
    const model = scripted([
      Effect.succeed(
        call("show_chart", {
          ...brazil,
          chart: "ranking",
          from: null,
          to: null,
          year: 2010,
          span_from: 2000,
          span_to: 2002,
        }),
      ),
    ])

    return Effect.gen(function* () {
      yield* answer("How has the ranking of life expectancy evolved since 2000?")

      expect(model.prompts[1]).toContain("year must lie inside span")
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  for (const { name, args, view } of drawn) {
    it.effect(`draws ${name} instead of rejecting it`, () => {
      const model = scripted([Effect.succeed(call("show_chart", { ...brazil, ...args }))])

      return Effect.gen(function* () {
        const steps = yield* answer("Life expectancy across countries")

        expect(steps.at(-1)).toEqual(charted(chart(view), said()))
      }).pipe(Effect.provide(serveApi(model.layer)))
    })
  }

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
          charted(
            chart(
              Trend.make({
                indicator: IndicatorId.make("ESTAT,UNE_RT_A,1.0"),
                countries: ["FRA"],
                from: Year.make(2022),
                to: Year.make(2024),
                dimensions: totalAged15To74,
              }),
            ),
            said(),
          ),
        )
      }).pipe(Effect.provide(serveApi(model.layer)))
    },
  )

  it.effect("keeps an answer in words alone, without a chart", () => {
    const model = scripted([Effect.succeed(words("No indicator measures that."))])

    const answered = charted(said("No indicator measures that."))

    return Effect.gen(function* () {
      expect(yield* answer("What is the meaning of life?")).toEqual([
        ...thinking(0),
        rendered(said("No indicator measures that."), 0),
        answered,
      ])
      expect(yield* turns).toEqual({
        answered: [
          {
            question: "What is the meaning of life?",
            answer: answered,
            steps: [],
            took: Duration.zero,
          },
        ],
      })
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("keeps a question the model stops on without a word as unanswered", () => {
    const model = scripted([silent])

    return Effect.gen(function* () {
      expect((yield* answer("What is the meaning of life?")).at(-1)).toEqual(Unanswered.make({}))
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("reads an indicator's definition to the model when asked to", () => {
    const model = scripted([
      Effect.succeed(
        call("describe_indicator", { indicator: lifeExpectancy, countries: [], dimensions: null }),
      ),
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
      silent,
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

  it.effect("reads a Eurostat dataflow's name, source and notes to the model", () => {
    const model = scripted([
      Effect.succeed(
        call("describe_indicator", {
          indicator: "ESTAT,UNE_RT_A,1.0",
          countries: [],
          dimensions: null,
        }),
      ),
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
      // Eurostat's notes on comparability over time, with where they came from.
      expect(model.prompts[1]).toContain(
        "The changes in the derivation of the labour status can cause breaks in the time series",
      )
      expect(model.prompts[1]).toContain(
        `"url":"${eurostat}/files?file=metadata/lfsi_esms.sdmx.zip"`,
      )
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("reads the definition alone when the source's notes cannot be reached", () => {
    const model = scripted([
      Effect.succeed(
        call("describe_indicator", {
          indicator: "ESTAT,UNE_RT_A,1.0",
          countries: [],
          dimensions: null,
        }),
      ),
      Effect.succeed(words("No chart.")),
    ])

    const down = Notes.layer.pipe(
      Layer.provide(http(() => new globalThis.Response("busy", { status: 503 }))),
      Layer.provide(memory().layer),
    )

    return Effect.gen(function* () {
      yield* answer("How does Eurostat measure unemployment?")

      expect(model.prompts[1]).toContain('"name":"Unemployment by sex and age - annual data"')
      expect(model.prompts[1]).toContain('"notes":null')
    }).pipe(Effect.provide(serveApi(model.layer, { notes: down })))
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
      version: Effect.fail(new SourceUnavailable({ source: "World Bank" })),
      series: () => Effect.fail(new SourceUnavailable({ source: "World Bank" })),
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
      const model = scripted([
        Effect.succeed(call("describe_indicator", { indicator, countries: [], dimensions: null })),
      ])

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

      expect((yield* answer("Life expectancy")).at(-1)).toEqual(charted(chart(brazilTrend), said()))
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
            answer: charted(chart(brazilTrend), said()),
            steps: [fetched()],
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

        expect((yield* Fiber.join(first)).at(-1)).toEqual(charted(chart(brazilTrend), said()))
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

      const answered = charted(chart(brazilTrend), said())

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

        expect(log(yield* Stream.runCollect(following))).toEqual([searched(), fetched(), answered])
        expect(yield* turns).toEqual({
          answered: [
            {
              question: "Life expectancy in Brazil",
              answer: answered,
              steps: [searched(), fetched()],
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
        expect((yield* answer("Life expectancy in Mexico")).at(-1)).toEqual(charted(said()))
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
          version: Effect.die("not used by conversations"),
          series: () => Effect.die("not used by conversations"),
        }),
      )

      const model = scripted([
        Effect.succeed(
          call("describe_indicator", {
            indicator: lifeExpectancy,
            countries: [],
            dimensions: null,
          }),
        ),
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
            answer: charted(chart(brazilTrend), said()),
            steps: [fetched()],
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
        Effect.succeed(
          call("describe_indicator", {
            indicator: lifeExpectancy,
            countries: [],
            dimensions: null,
          }),
        ),
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
              answer: charted(chart(brazilTrend), said()),
              steps: [
                searched(),
                Definition.make({
                  id: StepId.make("call-describe_indicator"),
                  indicator: lifeExpectancy,
                  state: Read.make({ name: "Life expectancy at birth, total (years)" }),
                }),
                fetched(),
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
      expect((yield* turns).answered[0]?.answer).toEqual(charted(chart(brazilTrend), said()))
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
      expect(onScreen(model.prompts[2] ?? "")).toEqual([
        { chart: 1, draft: { ...brazil, transform: "PerPerson" } },
      ])
      expect(model.prompts[2]).toContain(String.raw`\n\nAdd Mexico`)

      // The answer to "Add Mexico" is newer than the change: the next
      // question builds on it, and the chat holds the one note it had.
      yield* answer("Now as a ranking")

      expect(onScreen(model.prompts[4] ?? "")).toHaveLength(1)
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

        expect((yield* Fiber.join(second)).at(-1)).toEqual(charted(chart(mexico), said()))

        const [first, last] = (yield* turns).answered

        expect(first?.shown).toEqual([perPerson])
        expect(last?.answer).toEqual(charted(chart(mexico), said()))
      }).pipe(Effect.provide(serveApi(model.layer)))
    }),
  )
})

describe("several charts", () => {
  const change = { ...brazil, chart: "change" }

  const brazilChange = Change.make({
    indicator: lifeExpectancy,
    countries: ["BRA"],
    from: Year.make(2000),
    to: Year.make(2002),
  })

  const rose = "Life expectancy in Brazil rose from 70 years in 2000 to 72 in 2002."

  it.effect("answers with the charts and words each part of the question needs", () => {
    const model = scripted([
      Effect.succeed(call("show_chart", brazil, { step: "chart-1" })),
      Effect.succeed(saying(takeaway, call("show_chart", change, { step: "chart-2" }))),
      Effect.succeed(words(rose)),
    ])

    const answered = charted(chart(brazilTrend), said(), chart(brazilChange), said(rose))

    return Effect.gen(function* () {
      expect(
        log(yield* answer("How has life expectancy moved in Brazil, and by how much?")),
      ).toEqual([
        fetched(undefined, { step: "chart-1" }),
        // A change reads its two years only.
        fetched(Fetched.make({ values: 2 }), { step: "chart-2", view: brazilChange }),
        answered,
      ])
      expect((yield* turns).answered[0]?.answer).toEqual(answered)
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("shows every chart a round draws, in the order the model called them", () => {
    const both: ReadonlyArray<Response.PartEncoded> = [
      { type: "tool-call", id: "chart-1", name: "show_chart", params: brazil },
      { type: "tool-call", id: "chart-2", name: "show_chart", params: change },
      finish,
    ]

    const model = scripted([Effect.succeed(both)])

    return Effect.gen(function* () {
      expect((yield* answer("Life expectancy in Brazil, and its change")).at(-1)).toEqual(
        charted(chart(brazilTrend), chart(brazilChange), said()),
      )
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("ends the answer after its last round, keeping what it showed", () => {
    const model = scripted([
      ...Array.from({ length: 18 }, (_, round) =>
        Effect.succeed(call("show_chart", brazil, { step: `chart-${round}` })),
      ),
      Effect.die("the model must not be asked a nineteenth time"),
    ])

    return Effect.gen(function* () {
      const ending = (yield* answer("Life expectancy in Brazil, again and again")).at(-1)

      expect(ending).toEqual(Answered.make({ blocks: Arr.makeBy(18, () => chart(brazilTrend)) }))
      expect(model.prompts).toHaveLength(18)
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("tells the model which chart a person changed, by its place in the answer", () => {
    const model = scripted([
      Effect.succeed(call("show_chart", brazil, { step: "chart-1" })),
      Effect.succeed(saying(takeaway, call("show_chart", change, { step: "chart-2" }))),
      Effect.succeed(words(rose)),
    ])

    const perPerson = Change.make({ ...brazilChange, transform: "PerPerson" })

    return Effect.gen(function* () {
      yield* answer("Life expectancy in Brazil, and its change")
      yield* show(0, perPerson, { chart: 1 })

      expect((yield* turns).answered[0]?.shown).toEqual([null, perPerson])

      yield* answer("Add Mexico")

      expect(onScreen(model.prompts[3] ?? "")).toEqual([
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
})

// The first block of an answer, sent once its round ends.
const firstBlock = (step: Step) => isRendered(step) && step.id === "block-0"

describe("charts as they are drawn", () => {
  const change = { ...brazil, chart: "change" }

  const brazilChange = Change.make({
    indicator: lifeExpectancy,
    countries: ["BRA"],
    from: Year.make(2000),
    to: Year.make(2002),
  })

  const isFetch = Schema.is(Fetch)

  // A model that draws a chart, then waits on `next` before it goes on.
  const twoCharts = (next: Deferred.Deferred<ReadonlyArray<Response.PartEncoded>>) =>
    scripted([
      Effect.succeed(call("show_chart", brazil, { step: "chart-1" })),
      Deferred.await(next),
      Effect.succeed(words(takeaway)),
    ])

  // What the model writes and draws once `next` lets it.
  const second = saying(takeaway, call("show_chart", change, { step: "chart-2" }))

  it.effect("sends the first chart before the second is fetched", () =>
    Effect.gen(function* () {
      const next = yield* Deferred.make<ReadonlyArray<Response.PartEncoded>>()
      const model = twoCharts(next)

      return yield* Effect.gen(function* () {
        const first = yield* ask("Life expectancy in Brazil, and its change").pipe(
          Effect.flatMap((steps) => steps.pipe(Stream.takeUntil(firstBlock), Stream.runCollect)),
        )

        expect(first.filter(isRendered)).toEqual([rendered(chart(brazilTrend), 0)])
        expect(first.filter(isFetch).map((step) => step.id)).not.toContain("chart-2")

        const following = yield* follow

        yield* Deferred.succeed(next, second)

        expect((yield* Stream.runCollect(following)).at(-1)).toEqual(
          charted(chart(brazilTrend), said(), chart(brazilChange), said()),
        )
      }).pipe(Effect.provide(serveApi(model.layer)))
    }),
  )

  it.effect("sends a follower who joins late the blocks sent so far", () =>
    Effect.gen(function* () {
      const next = yield* Deferred.make<ReadonlyArray<Response.PartEncoded>>()
      const model = twoCharts(next)

      return yield* Effect.gen(function* () {
        // The visitor sees the first chart, then closes the tab.
        yield* ask("Life expectancy in Brazil, and its change").pipe(
          Effect.flatMap((steps) => steps.pipe(Stream.takeUntil(firstBlock), Stream.runDrain)),
        )

        const following = yield* follow

        yield* Deferred.succeed(next, second)

        expect((yield* Stream.runCollect(following)).filter(isRendered)).toEqual(
          [chart(brazilTrend), said(), chart(brazilChange), said()].map(rendered),
        )
      }).pipe(Effect.provide(serveApi(model.layer)))
    }),
  )

  it.effect("keeps the blocks sent before a stop", () => {
    // The model decides what comes after the first chart until the stop.
    const model = scripted([Effect.succeed(call("show_chart", brazil)), Effect.never])

    const stopped = Stopped.make({ blocks: [chart(brazilTrend)] })

    return Effect.gen(function* () {
      // The person sees the first chart, then stops the answer.
      yield* ask("Life expectancy in Brazil, and its change").pipe(
        Effect.flatMap((steps) => steps.pipe(Stream.takeUntil(firstBlock), Stream.runDrain)),
      )

      const following = yield* follow

      yield* stop

      expect((yield* Stream.runCollect(following)).at(-1)).toEqual(stopped)
      expect((yield* turns).answered[0]?.answer).toEqual(stopped)
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

  it.effect("says what a chart shows from a summary of its values", () => {
    const written = "Life expectancy in Brazil rose from 70 years in 2000 to 72 in 2002."
    const model = scripted([Effect.succeed(words(written))])

    return Effect.gen(function* () {
      expect(yield* explain(brazilTrend)).toEqual({ view: brazilTrend, text: written })
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

  it.effect("fails with AgentUnavailable when the model fails or writes nothing", () => {
    const model = scripted([fails, Effect.succeed(words("  "))])

    return Effect.gen(function* () {
      expect(yield* explain(brazilTrend).pipe(Effect.flip)).toBeInstanceOf(AgentUnavailable)
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

// The model looks up the political records of some countries, 2015 to 2016.
const records = (countries: ReadonlyArray<string>, { step }: { step: string }) =>
  call("find_politics", { countries, from: 2015, to: 2016 }, { step })

// That lookup's step, as it last stood.
const looked = (
  step: string,
  countries: Arr.NonEmptyReadonlyArray<Country>,
  state: typeof Records.Type.state,
) =>
  Records.make({
    id: StepId.make(step),
    countries,
    from: Year.make(2015),
    to: Year.make(2016),
    state,
  })

describe("political context", () => {
  beforeEach(emptyPolitics)

  // The records built from the recorded archives: Spain's governments and
  // elections among them, none for Brazil.
  const politics = politicsOver(archived())

  // Stores the records in the test Worker's D1 database, where the agent's
  // own Politics reads them.
  const built = build(1).pipe(Effect.provide(politics))

  const spainTrend = Trend.make({
    indicator: lifeExpectancy,
    countries: ["ESP"],
    from: Year.make(2000),
    to: Year.make(2002),
  })

  const spain = { ...brazil, countries: ["ESP"] }

  it.effect("looks up the records of a covered and an uncovered country for the model", () => {
    const model = scripted([
      Effect.succeed(records(["ESP"], { step: "spain" })),
      Effect.succeed(records(["BRA"], { step: "brazil" })),
      silent,
    ])

    return Effect.gen(function* () {
      yield* built

      const steps = yield* answer(
        "How did life expectancy move in Spain and Brazil around their 2015 elections?",
      )

      expect(log(steps)).toEqual([
        looked(
          "spain",
          ["ESP"],
          Recorded.make({ governments: 3, elections: 2, events: 1, reforms: 0 }),
        ),
        looked(
          "brazil",
          ["BRA"],
          Recorded.make({ governments: 0, elections: 0, events: 0, reforms: 0 }),
        ),
        Unanswered.make({}),
      ])

      // Each record goes to the model with its id; Brazil has none of its own.
      expect(model.prompts[1]).toContain(
        '"id":"government:ESP:2011-12-21","country":"ESP","head":"Mariano Rajoy"',
      )
      expect(model.prompts[2]).toContain('"uncovered":["BRA"]')
    }).pipe(Effect.provide(serveApi(model.layer, { politics })))
  })

  it.effect("tells the model when the records are unavailable, and answers without them", () => {
    const model = scripted([Effect.succeed(records(["ESP"], { step: "spain" })), silent])

    return Effect.gen(function* () {
      const steps = yield* answer("How did life expectancy move in Spain around its 2015 election?")

      expect(log(steps)[0]).toEqual(
        looked("spain", ["ESP"], Failed.make({ reason: new PoliticsUnavailable() })),
      )
      expect(model.prompts[1]).toContain("Political records are unavailable now")
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("answers with a trend that opens with the governments shown", () => {
    const model = scripted([
      Effect.succeed(call("show_chart", { ...spain, overlays: ["governments"] })),
    ])

    const governed = Chart.make({ view: spainTrend, overlays: ["governments"] })

    return Effect.gen(function* () {
      yield* built

      const steps = yield* answer("Life expectancy in Spain under each prime minister")

      expect(steps.find(isRendered)).toEqual(rendered(governed, 0))
      expect(steps.at(-1)).toEqual(charted(governed, said()))
      expect((yield* turns).answered[0]?.answer).toEqual(charted(governed, said()))
    }).pipe(Effect.provide(serveApi(model.layer, { politics })))
  })

  it.effect("tells the model that only a trend shows political context", () => {
    const model = scripted([
      Effect.succeed(
        call("show_chart", {
          ...spain,
          chart: "ranking",
          from: null,
          to: null,
          year: 2002,
          overlays: ["events"],
        }),
      ),
      silent,
    ])

    return Effect.gen(function* () {
      expect(log(yield* answer("Spain's life expectancy in 2002, with events"))).toEqual([
        Unanswered.make({}),
      ])
      expect(model.prompts[1]).toContain("Only a trend shows elections, governments or events")
    }).pipe(Effect.provide(serveApi(model.layer, { politics })))
  })

  it.effect("streams words linking the record they cite by its name, and keeps the record", () => {
    const model = scripted([
      Effect.succeed(records(["ESP"], { step: "spain" })),
      Effect.succeed(call("show_chart", { ...spain, overlays: ["governments"] })),
      Effect.succeed(
        words("Life expectancy rose in Spain before [[government:ESP:2011-12-21]] governed."),
      ),
    ])

    const text = "Life expectancy rose in Spain before [Mariano Rajoy](cite:0) governed."

    return Effect.gen(function* () {
      yield* built

      const steps = yield* answer("Life expectancy in Spain under each prime minister")
      const written = steps.findLast(isRendered)

      expect(written?.block).toMatchObject({
        text,
        cites: [{ government: { head: "Mariano Rajoy", start: "2011-12-21" } }],
      })
      expect((yield* turns).answered[0]?.answer).toMatchObject({
        blocks: [
          { overlays: ["governments"] },
          { text, cites: [{ government: { head: "Mariano Rajoy" } }] },
        ],
      })
    }).pipe(Effect.provide(serveApi(model.layer, { politics })))
  })

  it.effect("leaves out words that cite a record the agent did not look up", () => {
    const model = scripted([
      Effect.succeed(call("show_chart", spain)),
      Effect.succeed(
        words("Life expectancy rose in Spain before [[government:ESP:2011-12-21]] governed."),
      ),
    ])

    return Effect.gen(function* () {
      yield* built

      expect((yield* answer("How has life expectancy changed in Spain?")).at(-1)).toEqual(
        charted(chart(spainTrend)),
      )
    }).pipe(Effect.provide(serveApi(model.layer, { politics })))
  })
})

const unemployment = IndicatorId.make("SL.UEM.TOTL.ZS")

const krebs: Study = {
  authors: ["Krebs, Tom", "Scheffel, Martin"],
  year: 2013,
  title: "Macroeconomic Evaluation of Labor Market Reform in Germany",
  publisher: "IMF Working Paper 13/42",
  doi: null,
  url: "https://www.imf.org/external/pubs/ft/wp/2013/wp1342.pdf",
}

const launov: Study = {
  authors: ["Launov, Andrey", "Wälde, Klaus"],
  year: 2010,
  title: "Estimating Incentive and Welfare Effects of Non-Stationary Unemployment Benefits",
  publisher: "IZA Discussion Paper 4740",
  doi: null,
  url: "https://docs.iza.org/dp4740.pdf",
}

// A finding valid as it stands: one study's result on German unemployment,
// 2003 to 2010. A test changes what it asserts on.
const finding = (changes: Partial<Finding> = {}) =>
  Finding.make({
    id: "hartz-reforms",
    name: "the Hartz reforms' effect on unemployment",
    claim: "Germany's labour-market reforms lowered unemployment.",
    indicators: [unemployment],
    scope: Scope.cases.Countries.make({ countries: ["DEU"] }),
    from: Year.make(2003),
    to: Year.make(2010),
    evidence: Evidence.cases.Single.make({ study: krebs }),
    ...changes,
  })

// The model looks up the findings on unemployment in Germany and Spain,
// 2005 to 2012, unless a test asks for others.
const research = (asked: Arguments = {}) =>
  call("find_research", {
    indicator: unemployment,
    countries: ["DEU", "ESP"],
    from: 2005,
    to: 2012,
    ...asked,
  })

describe("research findings", () => {
  it.effect("tells the model the findings that cover the indicator, countries and years", () => {
    const model = scripted([Effect.succeed(research()), silent])

    const findings = Findings.holding([
      finding(),
      finding({ id: "worldwide", scope: Scope.cases.World.make({}) }),
      finding({ id: "life-expectancy", indicators: [lifeExpectancy] }),
      finding({ id: "france", scope: Scope.cases.Countries.make({ countries: ["FRA"] }) }),
      finding({ id: "nineties", from: Year.make(1991), to: Year.make(1995) }),
    ])

    return Effect.gen(function* () {
      const steps = yield* answer("Why did unemployment fall in Germany after 2005?")

      expect(log(steps)).toEqual([
        Research.make({
          id: StepId.make("call-find_research"),
          indicator: unemployment,
          countries: ["DEU", "ESP"],
          from: Year.make(2005),
          to: Year.make(2012),
          state: Researched.make({
            findings: [
              {
                id: RecordId.make("finding:hartz-reforms"),
                name: "the Hartz reforms' effect on unemployment",
              },
              {
                id: RecordId.make("finding:worldwide"),
                name: "the Hartz reforms' effect on unemployment",
              },
            ],
          }),
        }),
        Unanswered.make({}),
      ])
      expect(model.prompts[1]).toContain(
        '"id":"finding:hartz-reforms","name":"the Hartz reforms\' effect on unemployment","claim":"Germany\'s labour-market reforms lowered unemployment.","countries":["DEU"]',
      )
      expect(model.prompts[1]).toContain('"settled":"one study"')
      expect(model.prompts[1]).toContain('"supporting":["Krebs and Scheffel (2013)"]')

      for (const other of ["life-expectancy", "france", "nineties"]) {
        expect(model.prompts[1]).not.toContain(`finding:${other}`)
      }
    }).pipe(Effect.provide(serveApi(model.layer, { findings })))
  })

  it.effect("tells the model both sides of a disputed finding", () => {
    const model = scripted([Effect.succeed(research()), silent])

    const disputed = finding({
      evidence: Evidence.cases.Disputed.make({
        supporting: [krebs],
        disputing: [launov],
        objection: "Other studies find the reforms lowered unemployment only a little.",
      }),
    })

    return Effect.gen(function* () {
      yield* answer("Why did unemployment fall in Germany after 2005?")

      expect(model.prompts[1]).toContain(
        '"settled":"disputed","objection":"Other studies find the reforms lowered unemployment only a little.","supporting":["Krebs and Scheffel (2013)"],"disputing":["Launov and Wälde (2010)"]',
      )
    }).pipe(Effect.provide(serveApi(model.layer, { findings: Findings.holding([disputed]) })))
  })

  it.effect("tells the model when years do not decode, and looks nothing up", () => {
    const model = scripted([Effect.succeed(research({ from: 2012, to: 2005 })), silent])

    return Effect.gen(function* () {
      expect(log(yield* answer("Why did unemployment fall in Germany?"))).toEqual([
        Unanswered.make({}),
      ])
      expect(model.prompts[1]).toContain("from must not be after to")
    }).pipe(Effect.provide(serveApi(model.layer, { findings: Findings.holding([finding()]) })))
  })

  it.effect("streams words citing a finding by its name, and keeps the finding", () => {
    const model = scripted([
      Effect.succeed(research()),
      Effect.succeed(words("Studies found [[finding:hartz-reforms]].")),
    ])

    const text = "Studies found [the Hartz reforms' effect on unemployment](cite:0)."

    return Effect.gen(function* () {
      const steps = yield* answer("Why did unemployment fall in Germany after 2005?")

      expect(steps.findLast(isRendered)?.block).toMatchObject({
        text,
        cites: [{ finding: { id: "hartz-reforms" } }],
      })
      expect((yield* turns).answered[0]?.answer).toMatchObject({
        blocks: [{ text, cites: [{ finding: { id: "hartz-reforms" } }] }],
      })
    }).pipe(Effect.provide(serveApi(model.layer, { findings: Findings.holding([finding()]) })))
  })
})

// The day the participation rates were recorded: the recent years run from
// 1996 to 2026.
const recordedDay = TestClock.setTime(
  DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-10T11:00:00Z")),
)

const labourForce = IndicatorId.make("ESTAT,LFSI_EMP_A,1.0")

// The six countries of the trend, with Sweden added.
const withSweden = ["DEU", "FRA", "ITA", "ESP", "POL", "NLD", "SWE"] as const

// The share of 15 to 64 year-olds in the labour force, as the model picks
// it and as a View keeps it.
const activityRate = [
  { dimension: "indic_em", code: "ACT" },
  { dimension: "sex", code: "T" },
  { dimension: "age", code: "Y15-64" },
  { dimension: "unit", code: "PC_POP" },
]

const participationData = `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/LFSI_EMP_A/1.0/*?c[geo]=DE,FR,IT,ES,PL,NL,SE&c[freq]=A&c[indic_em]=ACT&c[sex]=T&c[age]=Y15-64&c[unit]=PC_POP&c[TIME_PERIOD]=ge:1996+le:2026&compress=false`

// Eurostat as recorded on 2026-11-10, behind the cache: labour force
// participation for the seven countries over the recent years, with the URL
// of each request that reached Eurostat.
const cachedEurostat = () => {
  const asked: Array<string> = []

  const layer = Sdmx.cached.pipe(
    Layer.provide(
      http((url) => {
        asked.push(url)

        return (
          new Map([
            [
              `${eurostat}/sdmx/2.1/dataflow/ESTAT/LFSI_EMP_A/1.0?format=JSON`,
              globalThis.Response.json(participationFlow),
            ],
            [
              `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/LFSI_EMP_A/1.0/*?c[geo]=DE,FR,IT,ES,PL,NL,SE&c[freq]=A&lastNObservations=1&compress=false`,
              new globalThis.Response(participationOptions),
            ],
            [participationData, new globalThis.Response(participation)],
          ]).get(url) ?? new globalThis.Response("no recording", { status: 404 })
        )
      }),
    ),
    Layer.provide(memory().layer),
  )

  return { layer, asked }
}

const isCoverage = Schema.is(Coverage)

// The year lookups of an answer, as each last was.
const coverages = (steps: ReadonlyArray<Step>) => log(steps).filter(isCoverage)

describe("finding years", () => {
  it.effect(
    "tells the model which years each country has, then draws the chart without asking the source again",
    () => {
      const source = cachedEurostat()

      const lookup = {
        indicator: labourForce,
        countries: withSweden,
        dimensions: activityRate,
      }

      const model = scripted([
        Effect.succeed(call("find_years", lookup)),
        Effect.succeed(
          call("show_chart", { ...brazil, ...lookup, chart: "change", from: 2009, to: 2025 }),
        ),
      ])

      const found = Covered.make({
        countries: [
          { country: "DEU", first: Year.make(2009), last: Year.make(2025) },
          { country: "FRA", first: Year.make(2003), last: Year.make(2025) },
          { country: "ITA", first: Year.make(2009), last: Year.make(2025) },
          { country: "ESP", first: Year.make(2009), last: Year.make(2025) },
          { country: "POL", first: Year.make(2009), last: Year.make(2025) },
          { country: "NLD", first: Year.make(2009), last: Year.make(2025) },
          { country: "SWE", first: Year.make(2005), last: Year.make(2025) },
        ],
        shared: [{ from: Year.make(2009), to: Year.make(2025) }],
        missing: [],
      })

      return Effect.gen(function* () {
        yield* recordedDay

        const steps = yield* answer("Add data for Sweden please")

        expect(coverages(steps)).toEqual([
          Coverage.make({
            id: StepId.make("call-find_years"),
            indicator: labourForce,
            countries: ["DEU", "FRA", "ITA", "ESP", "POL", "NLD", "SWE"],
            state: found,
          }),
        ])
        expect(model.prompts[1]).toContain(
          JSON.stringify({ from: 1996, to: 2026, ...Struct.omit(found, ["_tag"]) }).slice(1, -1),
        )
        expect(steps.at(-1)).toEqual(
          charted(
            chart(
              Change.make({
                indicator: labourForce,
                countries: withSweden,
                from: Year.make(2009),
                to: Year.make(2025),
                dimensions: Schema.decodeSync(Dimensions)({
                  indic_em: "ACT",
                  sex: "T",
                  age: "Y15-64",
                  unit: "PC_POP",
                }),
              }),
            ),
            said(),
          ),
        )
        // The chart's values came from the request find_years made.
        expect(source.asked.filter((url) => url.includes("TIME_PERIOD"))).toEqual([
          participationData,
        ])
      }).pipe(Effect.provide(serveApi(model.layer, { sdmx: source.layer })))
    },
  )

  it.effect("lists a country without any value as missing", () => {
    const model = scripted([
      Effect.succeed(
        call("find_years", {
          indicator: lifeExpectancy,
          countries: ["BRA", "ARG"],
          dimensions: null,
        }),
      ),
    ])

    return Effect.gen(function* () {
      yield* recordedDay

      const steps = yield* answer("Life expectancy in Brazil and Argentina")

      expect(coverages(steps).map(({ state }) => state)).toEqual([
        Covered.make({
          countries: [{ country: "BRA", first: Year.make(2000), last: Year.make(2002) }],
          shared: [{ from: Year.make(2000), to: Year.make(2002) }],
          missing: ["ARG"],
        }),
      ])
    }).pipe(Effect.provide(serveApi(model.layer)))
  })

  it.effect("rejects an unknown indicator and a series left open as show_chart does", () => {
    const model = scripted([
      Effect.succeed(
        call(
          "find_years",
          { indicator: "SP.NOPE", countries: ["BRA"], dimensions: null },
          { step: "years-1" },
        ),
      ),
      Effect.succeed(
        call(
          "find_years",
          { indicator: "ESTAT,UNE_RT_A,1.0", countries: ["FRA"], dimensions: null },
          { step: "years-2" },
        ),
      ),
    ])

    return Effect.gen(function* () {
      yield* recordedDay

      const steps = yield* answer("Unemployment in France")

      expect(coverages(steps).map(({ state }) => state)).toEqual([
        Unresolved.make({
          reason: Rejection.cases.NoIndicator.make({ indicator: IndicatorId.make("SP.NOPE") }),
        }),
        Unresolved.make({
          reason: Rejection.cases.OpenDimensions.make({
            open: [DimensionId.make("age"), DimensionId.make("unit"), DimensionId.make("sex")],
          }),
        }),
      ])
      expect(model.prompts[1]).toContain("There is no indicator SP.NOPE. Search for one.")
      expect(model.prompts[2]).toContain("sex (F Females, M Males, T Total)")
    }).pipe(Effect.provide(serveApi(model.layer)))
  })
})

describe("breaks in series", () => {
  it.effect("tells the model each break the source marks in the years a change spans", () => {
    const model = scripted([
      Effect.succeed(
        call("show_chart", {
          ...brazil,
          chart: "change",
          indicator: labourForce,
          countries: withSweden,
          dimensions: activityRate,
          from: 2009,
          to: 2025,
        }),
      ),
    ])

    return Effect.gen(function* () {
      yield* recordedDay

      yield* answer("How has labour force participation changed since 2009?")

      // Eurostat flags Germany's 2010, 2011 and 2020 values, Italy's 2018 and
      // Poland's 2010 and 2019 with "b". The chart shows 2009 and 2025 only.
      expect(model.prompts[1]).toContain(
        JSON.stringify({
          breaks: [
            { country: "DEU", year: 2010 },
            { country: "DEU", year: 2011 },
            { country: "DEU", year: 2020 },
            { country: "ITA", year: 2018 },
            { country: "POL", year: 2010 },
            { country: "POL", year: 2019 },
          ],
          provisional: 0,
          estimated: 0,
        }),
      )
    }).pipe(Effect.provide(serveApi(model.layer, { sdmx: cachedEurostat().layer })))
  })
})
