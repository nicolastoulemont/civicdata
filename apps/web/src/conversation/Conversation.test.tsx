import {
  AgentUnavailable,
  Answered,
  type Block,
  Asked,
  CatalogUnavailable,
  Chart,
  ConversationBusy,
  ConversationId,
  Coverage,
  Covered,
  Cited,
  Day,
  Definition,
  End,
  Ended,
  Evidence,
  Failed,
  Fetch,
  Fetched,
  Finding,
  type Government,
  IndicatorId,
  Politics,
  Ranking,
  Read,
  RecordId,
  Recorded,
  Records,
  Rejected,
  Rejection,
  Rendered,
  Research,
  Researched,
  ResolvedView,
  Running,
  Scope,
  Search,
  Searched,
  SourceUnavailable,
  Step,
  StepId,
  Stopped,
  type Study,
  Text,
  TooManyQuestions,
  Trend,
  Turn,
  TurnNotFound,
  Turns,
  Unanswered,
  View,
  Year,
} from "@civicdata/domain"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import {
  act,
  fireEvent,
  getDefaultNormalizer,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type Array as Arr, Cause, DateTime, Duration, Schema, Struct } from "effect"
import { http, HttpResponse } from "msw/http"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { SidebarProvider } from "@/components/ui/sidebar"

import { line, typed } from "../../test/composer.ts"
import { network } from "../../test/network.ts"
import { Conversation } from "./Conversation.tsx"

const id = ConversationId.make("0b5d7c1e-8f4a-4c2b-9d3e-1a2b3c4d5e6f")

const lifeExpectancy = IndicatorId.make("SP.DYN.LE00.IN")

const brazil = Trend.make({
  indicator: lifeExpectancy,
  countries: ["BRA"],
  from: Year.make(2000),
  to: Year.make(2001),
})

const resolve = http.post("/api/views/resolve", async ({ request }) => {
  // The conversations here answer with trends and rankings only.
  const view = Schema.decodeUnknownSync(Schema.Union([Trend, Ranking]))(await request.json())

  return HttpResponse.json(
    Schema.encodeSync(ResolvedView)({
      view,
      title: "Life expectancy at birth (years)",
      indicator: {
        id: lifeExpectancy,
        name: "Life expectancy at birth, total (years)",
        definition: "",
      },
      observations: view.countries.flatMap((country) => [
        { country, year: Year.make(2000), value: 70.1 },
        { country, year: Year.make(2001), value: 70.4 },
      ]),
      missing: [],
      dimensions: [],
      disagreements: [],
      direction: "Higher",
      sources: [
        {
          indicator: lifeExpectancy,
          name: "Life expectancy at birth, total (years)",
          source: "World Bank",
          dataset: "World Development Indicators",
          url: `https://api.worldbank.org/v2/indicator/${lifeExpectancy}`,
          retrievedAt: DateTime.makeUnsafe("2026-11-08T00:00:00Z"),
        },
      ],
    }),
  )
})

const encodeTurns = Schema.encodeSync(Schema.toCodecJson(Turns))

const isAnswered = Schema.is(Answered)

const isChart = Schema.is(Chart)

// An answer of these blocks, in order.
const charted = (...blocks: Arr.NonEmptyReadonlyArray<Block>) => Answered.make({ blocks })

const plot = (view: View) => Chart.make({ view })

const said = (text: string) => Text.make({ text })

const sameView = (left: View, right: View) =>
  JSON.stringify(Schema.encodeSync(View)(left)) === JSON.stringify(Schema.encodeSync(View)(right))

// The turn showing `view` in place of its chart at `chart`, as the server
// keeps it: changed back to the agent's chart, a place keeps no change.
const showing = (turn: Turn, { chart, view }: { chart: number; view: View }): Turn => {
  const charts = isAnswered(turn.answer) ? turn.answer.blocks.filter(isChart) : []

  const shown = charts.map((agent, place) =>
    place === chart ? (sameView(agent.view, view) ? null : view) : (turn.shown?.[place] ?? null),
  )

  return shown.every((each) => each === null)
    ? Struct.omit(turn, ["shown"])
    : Struct.assign(turn, { shown })
}

// A conversation the server keeps between page loads, with the charts people
// changed its turns' charts to. Showing the agent's own chart changes it back.
const kept = (answered: ReadonlyArray<Turn>) => {
  let current = answered

  const handlers = [
    http.get(`/api/conversations/${id}`, () =>
      HttpResponse.json(encodeTurns({ answered: current })),
    ),
    http.put(`/api/conversations/${id}/turns/:turn/charts/:chart`, async ({ params, request }) => {
      const view = Schema.decodeUnknownSync(View)(await request.json())

      current = current.map((turn, index) =>
        index === Number(params["turn"])
          ? showing(turn, { chart: Number(params["chart"]), view })
          : turn,
      )

      return new HttpResponse(null, { status: 204 })
    }),
  ]

  return { handlers, turns: () => current }
}

const brazilAnswer = {
  question: "Life expectancy in Brazil",
  answer: charted(plot(brazil), said("Life expectancy in Brazil rose.")),
}

const mexico = Trend.make({ ...brazil, countries: ["MEX"] })

// An answer that took two charts.
const twoCharts = {
  question: "Life expectancy in Brazil, and in Mexico",
  answer: charted(
    plot(brazil),
    said("Life expectancy in Brazil rose."),
    plot(mexico),
    said("Life expectancy in Mexico rose."),
  ),
}

// Opens the chart's controls and adds Argentina to it.
const addArgentina = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: "Change" }))
  await user.type(screen.getByRole("combobox", { name: "Countries" }), "Argen")
  await user.click(await screen.findByRole("option", { name: "Argentina" }))
}

const turns = (answered: ReadonlyArray<Turn>, answering?: Turns["answering"]) =>
  http.get(`/api/conversations/${id}`, () =>
    HttpResponse.json(
      encodeTurns(answering === undefined ? { answered } : { answered, answering }),
    ),
  )

// When the server started the answers it is giving in these tests.
const started = DateTime.makeUnsafe("2026-11-09T12:00:00Z")

// Server-sent events as the API writes them: each step as a message, and a
// failure as its reserved event carrying the encoded cause.
const encodeStep = Schema.encodeSync(Schema.fromJsonString(Schema.toCodecJson(Step)))

const encodeFailure = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.toCodecJson(
      Schema.Cause(
        Schema.Union([AgentUnavailable, SourceUnavailable, CatalogUnavailable]),
        Schema.Defect(),
      ),
    ),
  ),
)

const message = (step: Step) => `event: message\ndata: ${encodeStep(step)}\n\n`

const failure = (error: AgentUnavailable | SourceUnavailable | CatalogUnavailable) =>
  `event: effect/http-api/stream/failure\ndata: ${encodeFailure(Cause.fail(error))}\n\n`

const events = (text: string) =>
  new HttpResponse(
    new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(new TextEncoder().encode(text))
        controller.close()
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  )

// An answer the test sends one event at a time, in reply to a question or to
// following the answer in progress.
const answer = (via: "ask" | "follow" = "ask") => {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined

  const body = new ReadableStream<Uint8Array>({
    start: (opened) => {
      controller = opened
    },
  })

  const reply = () => new HttpResponse(body, { headers: { "content-type": "text/event-stream" } })

  return {
    handler:
      via === "ask"
        ? http.post(`/api/conversations/${id}/questions`, reply)
        : http.get(`/api/conversations/${id}/answer`, reply),
    send: (event: string) => controller?.enqueue(encoder.encode(event)),
    end: () => controller?.close(),
    cut: () => controller?.error(new TypeError("The connection was lost")),
  }
}

const show = (first?: string) => {
  // The header's sidebar toggle needs the sidebar's provider.
  const root = createRootRoute({
    component: () => (
      <SidebarProvider>
        <Conversation id={id} first={first} />
      </SidebarProvider>
    ),
  })

  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={createRouter({ routeTree: root, history: createMemoryHistory() })} />
    </QueryClientProvider>,
  )
}

// A question in the timeline, not in the header that repeats the first one.
const findQuestion = async (text: string, options?: Parameters<typeof screen.findByText>[1]) =>
  within(await screen.findByRole("list", { name: "Questions and answers" })).findByText(
    text,
    options,
  )

const findComposer = () => screen.findByRole("textbox", { name: "Ask a follow-up" })

// A search that ended with one match, as a turn keeps it.
const searchedFor = (text: string) =>
  Ended.cases.Search.make({
    id: StepId.make(text),
    text,
    state: Searched.make({ count: 1, top: [] }),
  })

// A step's row in the work log, not its line for screen readers.
const findStep = async (text: string) =>
  within(await screen.findByRole("list", { name: "Steps" })).findByText(text)

// A chart fetched with two values, as a turn keeps it.
const fetchedChart = (step: string, view: View) =>
  Ended.cases.Fetch.make({ id: StepId.make(step), view, state: Fetched.make({ values: 2 }) })

// A block of the answer in progress, at its place, as the agent sends it.
const rendering = (block: Block, place: number) =>
  Rendered.make({ id: StepId.make(`block-${place}`), block })

// A search for life expectancy, running until a test gives it another state.
const searching = (state: typeof Search.Type.state = Running.make({})) =>
  Search.make({ id: StepId.make("search-1"), text: "life expectancy", state })

// The search once it ended, with what it found, as a turn keeps it.
const searched = Ended.cases.Search.make({
  id: StepId.make("search-1"),
  text: "life expectancy",
  state: Searched.make({
    count: 1,
    top: [{ indicator: lifeExpectancy, name: "Life expectancy at birth, total (years)" }],
  }),
})

// Three questions: one chart, two charts, and one no indicator answers.
const threeQuestions = [
  brazilAnswer,
  twoCharts,
  { question: "What about happiness?", answer: Unanswered.make({}) },
]

// happy-dom has no layout. Lays the questions out 800px apart in a 600px
// viewport, each where it sits at the viewport's scroll position.
const layOut = () => {
  const viewport = screen.getByRole("region", { name: "Conversation" })
  const questions = screen.getByRole("list", { name: "Questions and answers" }).children

  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, value: 2400 },
  })

  for (const [place, question] of [...questions].entries()) {
    question.getBoundingClientRect = () =>
      new DOMRect(0, place * 800 - viewport.scrollTop, 736, 700)
  }

  return viewport
}

const region = () => screen.getByRole("region", { name: "Conversation" })

// The scrolled content: the rows and the composer docked under them.
const content = () => region().firstElementChild

const rows = () => [...screen.getByRole("list", { name: "Questions and answers" }).children]

const minHeight = (element: Element | null | undefined) =>
  element instanceof HTMLElement ? Number.parseFloat(element.style.minHeight) || 0 : 0

// happy-dom has no layout. Lays the conversation out as a browser would in a
// 600px viewport, under a composer of no height: the rows start 24px below
// the top of the content, 32px apart and 32px above its end. A row is as tall
// as `heights` says at its place, 300px by default, or its inline min-height,
// and the content is at least as tall as the viewport and its own inline
// min-height. A scroll position stops at the end, as the content shrinks too.
// `resize` tells the resize observers, as a browser does after a row grows.
const browser = () => {
  const heights: Array<number> = []
  const observers = new Set<Observer>()
  let scrolled = 0

  class Observer implements ResizeObserver {
    readonly callback: ResizeObserverCallback

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }

    observe() {
      observers.add(this)
    }

    unobserve() {}

    disconnect() {
      observers.delete(this)
    }
  }

  vi.stubGlobal("ResizeObserver", Observer)
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })

  const height = (row: Element, place: number) => Math.max(heights[place] ?? 300, minHeight(row))

  const offset = (place: number) =>
    rows()
      .slice(0, place)
      .reduce((top, row, index) => top + height(row, index) + 32, 24)

  const scrollHeight = () => Math.max(600, offset(rows().length), minHeight(content()))

  const clamp = (top: number) => Math.min(Math.max(0, top), scrollHeight() - 600)

  const bounds = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    const top = clamp(scrolled)

    if (this === content()) return new DOMRect(0, -top, 736, scrollHeight())

    const place = rows().findIndex((row) => row.contains(this))

    if (place === -1) return new DOMRect(0, 0, 736, this === region() ? 600 : 0)

    return new DOMRect(0, offset(place) - top, 736, height(rows()[place]!, place))
  })

  onTestFinished(() => bounds.mockRestore())

  return {
    heights,
    // Gives the viewport its geometry once the conversation shows.
    measure: () =>
      Object.defineProperties(region(), {
        clientHeight: { configurable: true, value: 600 },
        scrollHeight: { configurable: true, get: scrollHeight },
        scrollTop: {
          configurable: true,
          get: () => clamp(scrolled),
          set: (top: number) => {
            scrolled = clamp(top)
          },
        },
      }),
    resize: () => {
      for (const observer of observers) observer.callback([], observer)
    },
    // How far below the top of the viewport a question sits.
    top: async (question: string) => (await findQuestion(question)).getBoundingClientRect().top,
  }
}

const findRail = () => screen.findByRole("toolbar", { name: "Questions" })

const ticksOf = (rail: HTMLElement) =>
  within(rail).getAllByRole("button", { name: /^Jump to question: / })

// José María Aznar's government of Spain, as PPEG records it.
const aznar: Government = {
  country: "ESP",
  head: "José María Aznar",
  parties: [{ name: "People's Party", abbreviation: "PP" }],
  color: null,
  start: Day.make("1996-05-05"),
  end: End.cases.Next.make({ day: Day.make("2004-04-17") }),
  citation: {
    publisher: "PPEG",
    url: "https://ppeg.wzb.eu/www/ppeg_gov_2025v1.zip",
    retrievedAt: DateTime.makeUnsafe("2026-11-09T04:00:00Z"),
  },
}

// The agent looking up France's political records, 2000 to 2024.
const looking = (state: typeof Records.Type.state) =>
  Records.make({
    id: StepId.make("records-1"),
    countries: ["FRA"],
    from: Year.make(2000),
    to: Year.make(2024),
    state,
  })

// The agent looking up labour force participation in seven countries.
const lookingUp = (state: typeof Coverage.Type.state) =>
  Coverage.make({
    id: StepId.make("years-1"),
    indicator: IndicatorId.make("ESTAT,LFSI_EMP_A,1.0"),
    countries: ["DEU", "FRA", "ITA", "ESP", "POL", "NLD", "SWE"],
    state,
  })

// The agent looking up research on unemployment in Germany and Spain.
const researching = (state: typeof Research.Type.state) =>
  Research.make({
    id: StepId.make("research-1"),
    indicator: IndicatorId.make("SL.UEM.TOTL.ZS"),
    countries: ["DEU", "ESP"],
    from: Year.make(2005),
    to: Year.make(2012),
    state,
  })

describe("Conversation", () => {
  it("asks the question from the home page, shows each step, then the chart", async () => {
    const reply = answer()

    network.use(turns([]), reply.handler, resolve)
    show("How has life expectancy changed in Brazil?")

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "How has life expectancy changed in Brazil?",
      }),
    ).toBeDefined()
    expect(await findQuestion("How has life expectancy changed in Brazil?")).toBeDefined()

    // The agent thinks before its first step.
    expect(await findStep("Thinking…")).toBeDefined()

    // A running step reads in the present tense, then in the past tense with
    // its result, in the same row.
    reply.send(message(searching()))
    expect(await findStep("Searching for “life expectancy”…")).toBeDefined()
    expect(screen.queryByText("Thinking…")).toBeNull()

    reply.send(message(searched))
    expect(await findStep("Searched for “life expectancy”: 1 found")).toBeDefined()
    expect(screen.queryByText("Searching for “life expectancy”…")).toBeNull()
    expect(
      within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem"),
    ).toHaveLength(2)

    reply.send(message(charted(plot(brazil), said("Life expectancy in Brazil rose."))))
    reply.end()

    expect(
      await screen.findByRole("heading", { name: "Life expectancy at birth (years)" }),
    ).toBeDefined()
    expect(screen.getByText("Life expectancy in Brazil rose.")).toBeDefined()
    expect(screen.queryByText("Searched for “life expectancy”: 1 found")).toBeNull()
  })

  it("opens a search to its best matches and their source", async () => {
    const reply = answer()
    const user = userEvent.setup()

    network.use(turns([]), reply.handler, resolve)
    show("Housing costs in Greece and Germany")

    reply.send(
      message(
        Search.make({
          id: StepId.make("search-2"),
          text: "housing",
          source: "Eurostat",
          state: Searched.make({
            count: 12,
            top: [
              {
                indicator: IndicatorId.make("ESTAT,ILC_LVHO07A,1.0"),
                name: "Housing cost overburden rate",
              },
            ],
          }),
        }),
      ),
    )
    reply.send(
      message(
        Definition.make({
          id: StepId.make("definition-1"),
          indicator: IndicatorId.make("ESTAT,ILC_LVHO07A,1.0"),
          state: Read.make({ name: "Housing cost overburden rate" }),
        }),
      ),
    )

    const row = await screen.findByRole("button", {
      name: "Searched Eurostat for “housing”: 12 found",
    })

    expect(row.getAttribute("aria-expanded")).toBe("false")

    await user.click(row)

    expect(await findStep("Housing cost overburden rate · Eurostat")).toBeDefined()
    // A row with nothing more to show does not open.
    expect(await findStep("Read “Housing cost overburden rate”")).toBeDefined()
    expect(screen.queryByRole("button", { name: /^Read/ })).toBeNull()
  })

  it("opens a chart the data rejected to why", async () => {
    const reply = answer()
    const step = StepId.make("chart-1")
    const later = Trend.make({ ...brazil, from: Year.make(2024), to: Year.make(2025) })

    network.use(turns([]), reply.handler, resolve)
    show("Life expectancy in Brazil")

    reply.send(message(Fetch.make({ id: step, view: later, state: Running.make({}) })))
    expect(await findStep("Fetching the World Bank data for 1 country, 2024–2025…")).toBeDefined()

    reply.send(
      message(
        Fetch.make({
          id: step,
          view: later,
          state: Rejected.make({ reason: Rejection.cases.NoValues.make({}) }),
        }),
      ),
    )
    await userEvent.setup().click(
      await screen.findByRole("button", {
        name: "Tried a chart the data can't show, trying again",
      }),
    )

    expect(await findStep("The World Bank has no values for Brazil in 2024–2025.")).toBeDefined()
  })

  it("opens years the data barely covers to the years it has", async () => {
    const reply = answer()
    const fifty = Trend.make({ ...brazil, from: Year.make(1976), to: Year.make(2025) })

    network.use(turns([]), reply.handler, resolve)
    show("Life expectancy in Brazil over the last 50 years")

    reply.send(
      message(
        Fetch.make({
          id: StepId.make("chart-1"),
          view: fifty,
          state: Rejected.make({
            reason: Rejection.cases.Short.make({ from: Year.make(2014), to: Year.make(2025) }),
          }),
        }),
      ),
    )
    await userEvent.setup().click(
      await screen.findByRole("button", {
        name: "Tried years the data barely covers, trying again",
      }),
    )

    expect(
      await findStep("The World Bank has values only from 2014 to 2025, under half of 1976–2025."),
    ).toBeDefined()
  })

  it("opens a chart too crowded to read to how many countries it had, and how many fit", async () => {
    const reply = answer()

    const crowded = Trend.make({
      ...brazil,
      countries: ["USA", "JPN", "DEU", "GBR", "FRA", "ITA", "CAN"],
    })

    network.use(turns([]), reply.handler, resolve)
    show("Life expectancy in the G7")

    reply.send(
      message(
        Fetch.make({
          id: StepId.make("chart-1"),
          view: crowded,
          state: Rejected.make({ reason: Rejection.cases.TooMany.make({ most: 6 }) }),
        }),
      ),
    )
    await userEvent.setup().click(
      await screen.findByRole("button", {
        name: "Tried a chart that would be hard to read, trying again",
      }),
    )

    expect(await findStep("Too many countries for a trend: 7, at most 6.")).toBeDefined()
  })

  it("says which political records the agent looked up, and how many it found", async () => {
    const reply = answer()

    network.use(turns([]), reply.handler)
    show("Unemployment in France under each president")

    reply.send(message(looking(Running.make({}))))
    expect(await findStep("Looking up the political record of France, 2000 to 2024…")).toBeDefined()

    reply.send(
      message(looking(Recorded.make({ governments: 4, elections: 2, events: 0, reforms: 0 }))),
    )
    expect(
      await findStep("Found 4 governments and 2 elections for France, 2000 to 2024"),
    ).toBeDefined()
  })

  it("says which research findings the agent looked up, opening to their names", async () => {
    const reply = answer()

    network.use(turns([]), reply.handler)
    show("Why did unemployment fall in Germany?")

    reply.send(message(researching(Running.make({}))))
    expect(await findStep("Looking up research on Germany and Spain, 2005 to 2012…")).toBeDefined()

    reply.send(
      message(
        researching(
          Researched.make({
            findings: [
              {
                id: RecordId.make("finding:hartz-reforms"),
                name: "a large effect of the Hartz reforms",
              },
            ],
          }),
        ),
      ),
    )
    await userEvent.setup().click(
      await screen.findByRole("button", {
        name: "Found 1 research finding on Germany and Spain, 2005 to 2012",
      }),
    )

    expect(await findStep("a large effect of the Hartz reforms")).toBeDefined()
  })

  it("says which years each country has data for, opening to each country's years", async () => {
    const reply = answer()

    network.use(turns([]), reply.handler)
    show("Add data for Sweden please")

    reply.send(message(lookingUp(Running.make({}))))
    expect(await findStep("Looking up which years Eurostat has for 7 countries…")).toBeDefined()

    reply.send(
      message(
        lookingUp(
          Covered.make({
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
          }),
        ),
      ),
    )
    await userEvent.setup().click(
      await screen.findByRole("button", {
        name: "Found values for 7 countries: all have 2009 to 2025, France from 2003, Sweden from 2005",
      }),
    )

    expect(await findStep("Sweden: 2005 to 2025")).toBeDefined()
  })

  it("says in plain words why a step failed", async () => {
    const reply = answer()

    network.use(turns([]), reply.handler)
    show("Unemployment in Spain and Japan")

    reply.send(
      message(
        Definition.make({
          id: StepId.make("definition-1"),
          indicator: IndicatorId.make("OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0"),
          state: Failed.make({ reason: new SourceUnavailable({ source: "OECD" }) }),
        }),
      ),
    )
    reply.send(failure(new SourceUnavailable({ source: "OECD" })))
    reply.end()

    expect(await findStep("Couldn't read the definition: the OECD didn't answer")).toBeDefined()
  })

  it("tells screen readers each step once, when it ends", async () => {
    const reply = answer()

    network.use(turns([]), reply.handler)
    show("Life expectancy in Brazil")

    reply.send(message(searching()))
    await findStep("Searching for “life expectancy”…")

    const log = screen.getByRole("log", { name: "Finished steps" })
    expect(log.textContent).toBe("")

    reply.send(message(searched))
    await findStep("Searched for “life expectancy”: 1 found")

    expect(within(log).getAllByText("Searched for “life expectancy”: 1 found")).toHaveLength(1)
    reply.end()
  })

  it("times the agent's work while it answers, then folds its steps under the answer", async () => {
    const reply = answer()
    const question = "How has life expectancy changed in Brazil?"
    let answered: ReadonlyArray<Turn> = []

    network.use(
      http.get(`/api/conversations/${id}`, () => HttpResponse.json(encodeTurns({ answered }))),
      reply.handler,
      resolve,
    )
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] })
    vi.setSystemTime(DateTime.toEpochMillis(started))

    try {
      show(question)

      expect(await screen.findByText("Working for 0s")).toBeDefined()

      reply.send(message(searched))
      const steps = await screen.findByRole("list", { name: "Steps" })
      expect(within(steps).getByText("Searched for “life expectancy”: 1 found")).toBeDefined()
      expect(within(steps).getByText("Thinking…")).toBeDefined()

      await act(async () => {
        vi.advanceTimersByTime(4_000)
      })
      expect(screen.getByText("Working for 4s")).toBeDefined()

      // The server saved the turn with the time it measured.
      answered = [
        {
          question,
          answer: charted(plot(brazil)),
          steps: [searched],
          took: Duration.seconds(8),
        },
      ]
      reply.send(message(charted(plot(brazil))))
      reply.end()

      const fold = await screen.findByRole("button", { name: "Worked for 8s · 1 search" })
      expect(fold.getAttribute("aria-expanded")).toBe("false")
      expect(screen.queryByText(/^Working for/)).toBeNull()
      expect(screen.queryByRole("list", { name: "Steps" })).toBeNull()
      expect(
        await screen.findByRole("heading", { name: "Life expectancy at birth (years)" }),
      ).toBeDefined()
    } finally {
      vi.useRealTimers()
    }

    await userEvent.setup().click(screen.getByRole("button", { name: "Worked for 8s · 1 search" }))

    expect(await findStep("Searched for “life expectancy”: 1 found")).toBeDefined()
  })

  it("counts the two kinds of work the agent did most on the folded line", async () => {
    network.use(
      turns([
        {
          question: "Life expectancy in Brazil",
          answer: charted(plot(brazil)),
          steps: [
            searchedFor("life expectancy"),
            Ended.cases.Definition.make({
              id: StepId.make("definition-1"),
              indicator: lifeExpectancy,
              state: Read.make({ name: "Life expectancy at birth, total (years)" }),
            }),
            searchedFor("longevity"),
            Ended.cases.Fetch.make({
              id: StepId.make("chart-1"),
              view: brazil,
              state: Fetched.make({ values: 2 }),
            }),
          ],
          took: Duration.seconds(8),
        },
      ]),
      resolve,
    )
    show()

    expect(
      await screen.findByRole("button", { name: "Worked for 8s · 2 searches, 1 definition" }),
    ).toBeDefined()
  })

  it("folds the saved steps of a reopened conversation, and none for older turns", async () => {
    network.use(
      turns([
        { question: "What about happiness?", answer: Unanswered.make({}) },
        {
          question: "Life expectancy in Brazil",
          answer: charted(plot(brazil)),
          steps: [
            searchedFor("life expectancy"),
            Ended.cases.Fetch.make({
              id: StepId.make("chart-1"),
              view: brazil,
              state: Rejected.make({ reason: Rejection.cases.NoValues.make({}) }),
            }),
          ],
          took: Duration.seconds(65),
        },
      ]),
      resolve,
    )
    show()

    const user = userEvent.setup()

    await user.click(await screen.findByRole("button", { name: "Worked for 1m 05s · 1 search" }))

    expect(
      within(await screen.findByRole("list", { name: "Steps" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Searched for “life expectancy”: 1 found",
      "Tried a chart the data can't show, trying again",
    ])

    await user.click(
      screen.getByRole("button", { name: "Tried a chart the data can't show, trying again" }),
    )
    expect(await findStep("The World Bank has no values for Brazil in 2000–2001.")).toBeDefined()
    expect(screen.getAllByRole("button", { name: /^Worked/ })).toHaveLength(1)
  })

  it("holds the view where the reader opens the steps, instead of following the end", async () => {
    network.use(
      turns([
        {
          question: "What about happiness?",
          answer: Unanswered.make({}),
          steps: [searched],
          took: Duration.seconds(3),
        },
      ]),
    )
    show()

    const fold = await screen.findByRole("button", { name: "Worked for 3s · 1 search" })
    const viewport = screen.getByRole("region", { name: "Conversation" })
    // happy-dom has no layout: the conversation is taller than its viewport.
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1600 },
    })
    fireEvent.scroll(viewport, { target: { scrollTop: 1000 } })
    expect(screen.queryByRole("button", { name: "Scroll to end" })).toBeNull()

    await userEvent.setup().click(fold)

    expect(await screen.findByRole("button", { name: "Scroll to end" })).toBeDefined()
    expect(viewport.scrollTop).toBe(1000)
  })

  it("times an answer followed after a reload from when the server started it", async () => {
    const reply = answer("follow")

    network.use(
      turns([], { question: "Life expectancy in Brazil", started }),
      reply.handler,
      resolve,
    )
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] })
    vi.setSystemTime(DateTime.toEpochMillis(started) + 6_000)

    try {
      show()

      expect(await screen.findByText("Working for 6s")).toBeDefined()
    } finally {
      vi.useRealTimers()
      reply.end()
    }
  })

  it("keeps the steps of a failed answer open above the problem", async () => {
    const reply = answer()

    network.use(turns([]), reply.handler)
    show("Life expectancy in Brazil")
    reply.send(message(searched))
    reply.send(failure(new AgentUnavailable()))
    reply.end()

    expect(await screen.findByRole("alert")).toBeDefined()
    expect(
      within(screen.getByRole("list", { name: "Steps" })).getByText(
        "Searched for “life expectancy”: 1 found",
      ),
    ).toBeDefined()
    expect(screen.queryByRole("button", { name: /^Worked/ })).toBeNull()
    expect(screen.queryByText(/^Working for/)).toBeNull()
  })

  it("heads each question and answer with who wrote it, for screen readers", async () => {
    network.use(
      turns([
        {
          question: "Life expectancy in Brazil",
          answer: charted(plot(brazil)),
        },
        { question: "What about happiness?", answer: Unanswered.make({}) },
      ]),
      resolve,
    )
    show()

    expect(await screen.findAllByRole("heading", { name: "You" })).toHaveLength(2)
    expect(screen.getAllByRole("heading", { name: "civicdata" })).toHaveLength(2)
  })

  it("offers a named button after scrolling up, and returns to the latest answer", async () => {
    network.use(turns([{ question: "What about happiness?", answer: Unanswered.make({}) }]))
    show()
    await screen.findByText("No World Bank indicator answers this question")
    const viewport = screen.getByRole("region", { name: "Conversation" })
    // happy-dom has no layout. Supply only the browser's geometry, keeping
    // the rendered feature and its scroll handlers real.
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1600 },
    })
    expect(screen.queryByRole("button", { name: "Scroll to end" })).toBeNull()
    fireEvent.scroll(viewport, { target: { scrollTop: 1000 } })
    fireEvent.scroll(viewport, { target: { scrollTop: 300 } })
    expect(await screen.findByRole("button", { name: "Scroll to end" })).toBeDefined()
    // Manual scrolling back to the end also resumes follow.
    fireEvent.scroll(viewport, { target: { scrollTop: 1000 } })
    expect(screen.queryByRole("button", { name: "Scroll to end" })).toBeNull()
    fireEvent.scroll(viewport, { target: { scrollTop: 300 } })
    await userEvent.setup().click(await screen.findByRole("button", { name: "Scroll to end" }))
    expect(viewport.scrollTop).toBe(1600)
    expect(screen.queryByRole("button", { name: "Scroll to end" })).toBeNull()
    expect(document.activeElement).toBe(viewport)
  })

  it("ends the conversation above the composer, which the answers scroll under", async () => {
    network.use(...kept([brazilAnswer]).handlers, resolve)
    show()

    const source = await screen.findByText(/^Source: World Bank/)
    const viewport = screen.getByRole("region", { name: "Conversation" })
    const composer = within(viewport).getByRole("textbox", { name: "Ask a follow-up" })

    // happy-dom has no layout. The composer docks at the end of the scrolled
    // content, so the last answer's source line ends above it and scrolls
    // fully into view however tall the composer grows.
    expect(source.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it("jumps between questions from the rail and marks the one in view", async () => {
    const user = userEvent.setup()

    network.use(turns(threeQuestions), resolve)
    show()

    const ticks = ticksOf(await findRail())

    expect(ticks.map((tick) => tick.getAttribute("aria-label"))).toEqual([
      "Jump to question: Life expectancy in Brazil",
      "Jump to question: Life expectancy in Brazil, and in Mexico",
      "Jump to question: What about happiness?",
    ])

    const viewport = layOut()

    await user.hover(ticks[1]!)
    const card = await screen.findByRole("tooltip")
    expect(within(card).getByText("Life expectancy in Brazil, and in Mexico")).toBeDefined()
    // The first thing the agent wrote starts the answer.
    expect(within(card).getByText("Life expectancy in Brazil rose.")).toBeDefined()

    await user.click(ticks[1]!)
    // The question lands 24px from the top. Browsers then fire a scroll event.
    await vi.waitFor(() => expect(viewport.scrollTop).toBe(776))
    fireEvent.scroll(viewport)

    expect(ticks[1]!.getAttribute("aria-current")).toBe("location")
    expect(ticks[0]!.getAttribute("aria-current")).toBeNull()
    expect(screen.getByRole("button", { name: "Scroll to end" })).toBeDefined()
  })

  it("reaches the rail by Tab, moves between its questions with arrows, and jumps with Enter", async () => {
    const user = userEvent.setup()

    network.use(turns(threeQuestions), resolve)
    show()

    const ticks = ticksOf(await findRail())
    const viewport = layOut()

    screen.getByRole("link", { name: "civicdata" }).focus()
    await user.tab()
    // The previous-question button is disabled at the first question.
    expect(document.activeElement).toBe(ticks[0])

    await user.keyboard("{ArrowDown}")
    expect(document.activeElement).toBe(ticks[1])
    expect(
      within(await screen.findByRole("tooltip")).getByText(
        "Life expectancy in Brazil, and in Mexico",
      ),
    ).toBeDefined()

    await user.keyboard("{Enter}")
    await vi.waitFor(() => expect(viewport.scrollTop).toBe(776))
  })

  it("shows no rail for a conversation of one question", async () => {
    network.use(turns([brazilAnswer]), resolve)
    show()

    expect(await screen.findByText("Life expectancy in Brazil rose.")).toBeDefined()
    expect(screen.queryByRole("toolbar", { name: "Questions" })).toBeNull()
  })

  it("puts the question being answered on the rail, answering", async () => {
    const user = userEvent.setup()
    const reply = answer("follow")

    network.use(
      turns([brazilAnswer], { question: "And in Mexico?", started }),
      reply.handler,
      resolve,
    )
    show()

    const ticks = ticksOf(await findRail())

    expect(ticks).toHaveLength(2)
    await user.hover(ticks[1]!)
    const card = await screen.findByRole("tooltip")
    expect(within(card).getByText("And in Mexico?")).toBeDefined()
    expect(within(card).getByText("Answering…")).toBeDefined()
  })

  it("copies a question", async () => {
    const user = userEvent.setup()

    network.use(
      turns([{ question: "What about happiness?", answer: Unanswered.make({}) }]),
      resolve,
    )
    show()

    await user.click(await screen.findByRole("button", { name: "Copy question" }))

    expect(await screen.findByRole("button", { name: "Copied" })).toBeDefined()
    expect(await navigator.clipboard.readText()).toBe("What about happiness?")
  })

  it("changes an answer's chart where it is, and copies a link to the changed chart", async () => {
    const user = userEvent.setup()

    network.use(...kept([brazilAnswer]).handlers, resolve)
    show()

    expect(await screen.findByText("Brazil · 2000–2001")).toBeDefined()
    expect(screen.queryByRole("combobox", { name: "Countries" })).toBeNull()

    await addArgentina(user)

    expect(await screen.findByText("Brazil and Argentina · 2000–2001")).toBeDefined()
    expect(
      await screen.findByText("This answer describes the charts before your changes."),
    ).toBeDefined()
    expect(screen.getByText("Life expectancy in Brazil rose.").parentElement?.className).toContain(
      "text-muted-foreground",
    )
    expect(screen.getByRole("button", { name: "Explain this chart" })).toBeDefined()

    await user.click(screen.getByRole("tab", { name: "Data" }))
    expect(
      await within(await screen.findByRole("table")).findAllByRole("cell", { name: "Argentina" }),
    ).toHaveLength(2)

    await user.click(screen.getByRole("button", { name: "Copy link" }))
    expect(await screen.findByRole("button", { name: "Link copied" })).toBeDefined()
    expect(await navigator.clipboard.readText()).toBe(
      "http://localhost:3000/explore?chart=trend&indicator=SP.DYN.LE00.IN&countries=BRA%2CARG&from=2000&to=2001",
    )
    expect(screen.queryByRole("link", { name: /explorer/ })).toBeNull()
  })

  it("shows an answer's words and charts in the order the agent wrote them, and counts the charts", async () => {
    network.use(
      ...kept([
        {
          ...twoCharts,
          steps: [
            searchedFor("life expectancy"),
            searchedFor("longevity"),
            searchedFor("life expectancy Mexico"),
            fetchedChart("chart-1", brazil),
            Ended.cases.Fetch.make({
              id: StepId.make("chart-2"),
              view: mexico,
              state: Rejected.make({ reason: Rejection.cases.NoValues.make({}) }),
            }),
            fetchedChart("chart-3", mexico),
          ],
          took: Duration.seconds(14),
        },
      ]).handlers,
      resolve,
    )
    show()

    const first = await screen.findByRole("region", { name: "Chart 1 of the answer" })
    const second = screen.getByRole("region", { name: "Chart 2 of the answer" })

    expect(await within(first).findByText("Brazil · 2000–2001")).toBeDefined()
    expect(await within(second).findByText("Mexico · 2000–2001")).toBeDefined()

    const brazilRose = screen.getByText("Life expectancy in Brazil rose.")

    // Each chart's words come after it, before the next chart.
    expect(first.compareDocumentPosition(brazilRose)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(brazilRose.compareDocumentPosition(second)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(
      second.compareDocumentPosition(screen.getByText("Life expectancy in Mexico rose.")),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    // The chart the data rejected is not one of them.
    expect(
      screen.getByRole("button", { name: "Worked for 14s · 3 searches, 2 charts" }),
    ).toBeDefined()
  })

  it("changes the second chart of an answer and leaves the first as it was", async () => {
    const user = userEvent.setup()
    const server = kept([twoCharts])

    network.use(...server.handlers, resolve)
    show()

    const second = await screen.findByRole("region", { name: "Chart 2 of the answer" })

    await user.click(within(second).getByRole("button", { name: "Change" }))
    await user.type(within(second).getByRole("combobox", { name: "Countries" }), "Argen")
    await user.click(await screen.findByRole("option", { name: "Argentina" }))

    expect(await within(second).findByText("Mexico and Argentina · 2000–2001")).toBeDefined()

    const first = screen.getByRole("region", { name: "Chart 1 of the answer" })

    expect(within(first).getByText("Brazil · 2000–2001")).toBeDefined()
    await vi.waitFor(() =>
      expect(server.turns()[0]?.shown).toEqual([
        null,
        Trend.make({ ...mexico, countries: ["MEX", "ARG"] }),
      ]),
    )
  })

  it("shows who governed in an answer's chart, and says when a country has no records", async () => {
    const user = userEvent.setup()

    network.use(
      ...kept([brazilAnswer]).handlers,
      resolve,
      http.get("/api/politics", () =>
        HttpResponse.json({ governments: [], elections: [], events: [], reforms: [] }),
      ),
    )
    show()

    await user.click(await screen.findByRole("button", { name: "Governments" }))

    expect(await screen.findByText("No government records for Brazil")).toBeDefined()
  })

  it("opens an answer's chart with the political context the agent turned on", async () => {
    const spain = Trend.make({ ...brazil, countries: ["ESP"] })

    network.use(
      ...kept([
        {
          question: "Life expectancy in Spain under each prime minister",
          answer: charted(Chart.make({ view: spain, overlays: ["governments"] })),
        },
      ]).handlers,
      resolve,
      http.get("/api/politics", () =>
        HttpResponse.json(
          Schema.encodeSync(Schema.toCodecJson(Politics))({
            governments: [aznar],
            elections: [],
            events: [],
            reforms: [],
          }),
        ),
      ),
    )
    show()

    expect(await screen.findByRole("button", { name: "Governments", pressed: true })).toBeDefined()
    expect(
      await screen.findByText(
        "Line chart of Life expectancy at birth (years) for Spain, shaded by head of government",
      ),
    ).toBeDefined()
    expect(screen.getByRole("button", { name: "Elections", pressed: false })).toBeDefined()
  })

  it("renders the agent's Markdown as lists and tables, without raw HTML or images", async () => {
    const text = [
      "Life expectancy rose in **both** countries:",
      "- Brazil gained the most\n- Mexico gained less",
      "| Country | 2001 |\n| --- | --- |\n| Brazil | 70.4 |",
      "<b>raw</b> ![chart](https://example.com/chart.png) [a link](javascript:alert(1))",
    ].join("\n\n")

    network.use(
      ...kept([
        { question: "Life expectancy in Brazil", answer: charted(plot(brazil), said(text)) },
      ]).handlers,
      resolve,
    )
    show()

    expect(await screen.findByText("both")).toBeDefined()
    expect(screen.getByText("both").tagName).toBe("STRONG")
    expect(screen.getByText("Brazil gained the most").tagName).toBe("LI")
    expect(screen.getByText("Mexico gained less").tagName).toBe("LI")
    expect(screen.getByRole("cell", { name: "Brazil" })).toBeDefined()
    // Raw HTML tags are dropped and their words kept as text.
    expect(screen.queryByText("raw", { selector: "b" })).toBeNull()
    expect(screen.queryByRole("img", { name: "chart" })).toBeNull()
    expect(screen.getByText("a link").getAttribute("href")).toBe("")
  })

  it("links each record the agent's words cite, and shows its card on hover", async () => {
    const user = userEvent.setup()
    const spain = Trend.make({ ...brazil, countries: ["ESP"] })
    // The record is cited in the second paragraph.
    const text = "Life expectancy in Spain rose.\n\nIt rose under [José María Aznar](cite:0)."

    network.use(
      ...kept([
        {
          question: "Life expectancy in Spain under each prime minister",
          answer: charted(
            plot(spain),
            Text.make({ text, cites: [Cited.cases.Government.make({ government: aznar })] }),
          ),
        },
      ]).handlers,
      resolve,
    )
    show()

    expect(await screen.findByText("Life expectancy in Spain rose.")).toBeDefined()

    const link = await screen.findByRole("link", { name: "José María Aznar" })

    expect(link.getAttribute("href")).toBe("https://ppeg.wzb.eu/www/ppeg_gov_2025v1.zip")

    await user.hover(link)

    expect(await screen.findByText("José María Aznar · PP · 1996 to 2004")).toBeDefined()
    expect(
      screen.getByRole("link", { name: "PPEG (Krause, Döring, Stoppe, WZB Berlin, 2025)" }),
    ).toBeDefined()
  })

  it("links a finding the agent's words cite, and shows its studies on hover", async () => {
    const user = userEvent.setup()
    const germany = Trend.make({ ...brazil, countries: ["DEU"] })

    const krebs: Study = {
      authors: ["Krebs, Tom", "Scheffel, Martin"],
      year: 2013,
      title: "Macroeconomic Evaluation of Labor Market Reform in Germany",
      publisher: "IMF Working Paper 13/42",
      doi: null,
      url: "https://www.imf.org/external/pubs/ft/wp/2013/wp1342.pdf",
    }

    const hartz = Finding.make({
      id: "hartz-reforms",
      name: "a large effect of the Hartz reforms",
      claim: "The Hartz reforms caused much of the fall in German unemployment after 2005.",
      indicators: [IndicatorId.make("SL.UEM.TOTL.ZS")],
      scope: Scope.cases.Countries.make({ countries: ["DEU"] }),
      from: Year.make(2005),
      to: Year.make(2012),
      evidence: Evidence.cases.Disputed.make({
        supporting: [krebs],
        disputing: [
          {
            authors: ["Launov, Andrey", "Wälde, Klaus"],
            year: 2010,
            title:
              "Estimating Incentive and Welfare Effects of Non-Stationary Unemployment Benefits",
            publisher: "IZA Discussion Paper 4740",
            doi: null,
            url: "https://docs.iza.org/dp4740.pdf",
          },
        ],
        objection: "Other studies find the reforms lowered unemployment only a little.",
      }),
    })

    const text = "Some studies found [a large effect of the Hartz reforms](cite:0)."

    network.use(
      ...kept([
        {
          question: "Why did unemployment fall in Germany?",
          answer: charted(
            plot(germany),
            Text.make({ text, cites: [Cited.cases.Finding.make({ finding: hartz })] }),
          ),
        },
      ]).handlers,
      resolve,
    )
    show()

    const link = await screen.findByRole("link", { name: "a large effect of the Hartz reforms" })

    expect(link.getAttribute("href")).toBe(krebs.url)

    await user.hover(link)

    expect(
      await screen.findByText(
        "The Hartz reforms caused much of the fall in German unemployment after 2005.",
      ),
    ).toBeDefined()
    expect(screen.getByText("Germany · 2005 to 2012")).toBeDefined()
    expect(
      screen.getByText(
        "Disputed: Other studies find the reforms lowered unemployment only a little.",
      ),
    ).toBeDefined()
    expect(
      screen
        .getByRole("link", {
          name: "Supports: Krebs and Scheffel (2013), Macroeconomic Evaluation of Labor Market Reform in Germany, IMF Working Paper 13/42",
        })
        .getAttribute("href"),
    ).toBe(krebs.url)
    expect(
      screen
        .getByRole("link", {
          name: "Disputes: Launov and Wälde (2010), Estimating Incentive and Welfare Effects of Non-Stationary Unemployment Benefits, IZA Discussion Paper 4740",
        })
        .getAttribute("href"),
    ).toBe("https://docs.iza.org/dp4740.pdf")
  })

  it("keeps a changed chart after a reload", async () => {
    const server = kept([brazilAnswer])

    network.use(...server.handlers, resolve)
    const page = show()

    await addArgentina(userEvent.setup())
    expect(await screen.findByText("Brazil and Argentina · 2000–2001")).toBeDefined()
    await vi.waitFor(() => expect(server.turns()[0]?.shown).toBeDefined())

    page.unmount()
    show()

    expect(await screen.findByText("Brazil and Argentina · 2000–2001")).toBeDefined()
    expect(
      await screen.findByText("This answer describes the charts before your changes."),
    ).toBeDefined()
  })

  it("moves a ranking over time from the agent's year, keeping the year let go on after a reload", async () => {
    const user = userEvent.setup()

    const server = kept([
      {
        question: "How has the ranking of life expectancy in Brazil and Mexico evolved?",
        answer: charted(
          plot(
            Ranking.make({
              indicator: lifeExpectancy,
              countries: ["BRA", "MEX"],
              year: Year.make(2001),
              span: { from: Year.make(2000), to: Year.make(2001) },
            }),
          ),
          said("Brazil and Mexico stayed level."),
        ),
      },
    ])

    network.use(...server.handlers, resolve)
    const page = show()

    const year = await screen.findByRole("slider", { name: "Year" })

    expect(screen.getByText("Agent's year 2001")).toBeDefined()

    act(() => year.focus())
    await user.keyboard("{ArrowLeft}")

    await vi.waitFor(() =>
      expect(server.turns()[0]?.shown?.[0]).toMatchObject({
        year: 2000,
        span: { from: 2000, to: 2001 },
      }),
    )
    expect(screen.getByRole("button", { name: "Back to the agent's chart" })).toBeDefined()

    page.unmount()
    show()

    const reloaded = await screen.findByRole("slider", { name: "Year" })

    expect(reloaded.getAttribute("aria-valuenow")).toBe("2000")
    expect(screen.getByText("Agent's year 2001")).toBeDefined()
  })

  it("switches an answer's ranking to over time and back to the agent's one year", async () => {
    const user = userEvent.setup()

    const ranking = Ranking.make({
      indicator: lifeExpectancy,
      countries: ["BRA", "MEX"],
      year: Year.make(2001),
    })

    const server = kept([
      {
        question: "Which has the higher life expectancy, Brazil or Mexico?",
        answer: charted(plot(ranking), said("They are level.")),
      },
    ])

    network.use(...server.handlers, resolve)
    show()

    await user.click(await screen.findByRole("button", { name: "Change" }))
    await user.click(screen.getByRole("button", { name: "Over time" }))

    expect(await screen.findByRole("slider", { name: "Year" })).toBeDefined()
    await vi.waitFor(() =>
      expect(server.turns()[0]?.shown?.[0]).toMatchObject({
        span: { from: 2000, to: 2001 },
        year: 2001,
      }),
    )

    await user.click(screen.getByRole("button", { name: "One year" }))

    await vi.waitFor(() => expect(server.turns()[0]).not.toHaveProperty("shown"))
    expect(screen.queryByRole("slider", { name: "Year" })).toBeNull()
  })

  it("goes back to the agent's chart, after a reload too", async () => {
    const user = userEvent.setup()
    const server = kept([brazilAnswer])

    network.use(...server.handlers, resolve)
    const page = show()

    await addArgentina(user)
    await vi.waitFor(() => expect(server.turns()[0]?.shown).toBeDefined())
    await user.click(await screen.findByRole("button", { name: "Back to the agent's chart" }))

    expect(await screen.findByText("Brazil · 2000–2001")).toBeDefined()
    expect(screen.queryByRole("button", { name: "Back to the agent's chart" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Explain this chart" })).toBeNull()
    await vi.waitFor(() => expect(server.turns()[0]).not.toHaveProperty("shown"))

    page.unmount()
    show()

    expect(await screen.findByText("Brazil · 2000–2001")).toBeDefined()
    expect(screen.queryByText("This answer describes the charts before your changes.")).toBeNull()
  })

  it("says why a change could not be kept, and shows the chart kept before", async () => {
    network.use(
      turns([brazilAnswer]),
      http.put(`/api/conversations/${id}/turns/:turn/charts/:chart`, () =>
        HttpResponse.json(Schema.encodeSync(TurnNotFound)(new TurnNotFound({ turn: 0 })), {
          status: 404,
        }),
      ),
      resolve,
    )
    show()

    await addArgentina(userEvent.setup())

    expect(await screen.findByText("Your change could not be kept")).toBeDefined()
    expect(screen.getByText("This conversation no longer has this answer.")).toBeDefined()
    expect(screen.getByText("Brazil · 2000–2001")).toBeDefined()
  })

  it("loads a trend's whole history only once its chart is being changed", async () => {
    const asked: Array<Year> = []

    network.use(
      turns([
        {
          question: "Life expectancy in Brazil",
          answer: charted(plot(brazil)),
        },
      ]),
      // Records the first year asked for, then lets `resolve` answer.
      http.post("/api/views/resolve", async ({ request }) => {
        asked.push(Schema.decodeUnknownSync(Trend)(await request.clone().json()).from)
      }),
      resolve,
    )
    show()

    await screen.findByText("Brazil · 2000–2001")
    expect(asked).toEqual([2000])

    await userEvent.setup().click(screen.getByRole("button", { name: "Change" }))

    expect(await screen.findByRole("slider", { name: "First year" })).toBeDefined()
    expect(asked).toEqual([2000, 1960])
  })

  it("holds the view where the reader changes a chart, instead of following the end", async () => {
    network.use(
      turns([
        {
          question: "Life expectancy in Brazil",
          answer: charted(plot(brazil)),
        },
      ]),
      resolve,
    )
    show()

    const change = await screen.findByRole("button", { name: "Change" })
    const viewport = screen.getByRole("region", { name: "Conversation" })
    // happy-dom has no layout: the conversation is taller than its viewport.
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1600 },
    })
    fireEvent.scroll(viewport, { target: { scrollTop: 1000 } })
    expect(screen.queryByRole("button", { name: "Scroll to end" })).toBeNull()

    await userEvent.setup().click(change)

    expect(await screen.findByRole("combobox", { name: "Countries" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Scroll to end" })).toBeDefined()
    expect(viewport.scrollTop).toBe(1000)
  })

  it("asks a follow-up below the earlier turns", async () => {
    const reply = answer()

    network.use(
      turns([
        {
          question: "Life expectancy in Brazil",
          answer: charted(plot(brazil)),
        },
      ]),
      reply.handler,
      resolve,
    )
    show()

    expect(
      await screen.findByRole("heading", { level: 1, name: "Life expectancy in Brazil" }),
    ).toBeDefined()

    const user = userEvent.setup()

    expect((await findComposer()).getAttribute("aria-placeholder")).toBe(
      "Add Mexico, or show it per person",
    )
    expect(
      screen.getByRole("button", { name: "Type a question to send" }).getAttribute("aria-disabled"),
    ).toBe("true")

    await user.type(await findComposer(), "What about happiness?")
    await user.click(screen.getByRole("button", { name: "Send" }))
    reply.send(message(Unanswered.make({})))
    reply.end()

    expect(await findQuestion("What about happiness?")).toBeDefined()
    expect(await screen.findByText("No World Bank indicator answers this question")).toBeDefined()
    // The header still names the conversation by its first question.
    expect(
      screen.getByRole("heading", { level: 1, name: "Life expectancy in Brazil" }),
    ).toBeDefined()
  })

  it("keeps a follow-up 24px from the top while its answer arrives, and after it", async () => {
    const layout = browser()
    const reply = answer()
    const user = userEvent.setup()

    network.use(turns([brazilAnswer]), reply.handler, resolve)
    layout.heights[0] = 700
    show()
    await screen.findByText("Life expectancy in Brazil rose.")
    layout.measure()

    await user.type(await findComposer(), "And in Mexico?")
    await user.click(screen.getByRole("button", { name: "Send" }))
    await vi.waitFor(async () => expect(await layout.top("And in Mexico?")).toBe(24))

    reply.send(message(searched))
    await findStep("Searched for “life expectancy”: 1 found")
    layout.resize()
    expect(await layout.top("And in Mexico?")).toBe(24)

    reply.send(message(rendering(plot(mexico), 0)))
    await screen.findByRole("heading", { name: "Life expectancy at birth (years)" })
    layout.heights[1] = 400
    layout.resize()
    expect(await layout.top("And in Mexico?")).toBe(24)

    reply.send(message(charted(plot(mexico), said("Life expectancy in Mexico rose."))))
    reply.end()
    await screen.findByRole("button", { name: /^Worked/ })
    layout.resize()
    expect(await layout.top("And in Mexico?")).toBe(24)
  })

  it("puts the first question of a conversation 24px from the top and keeps it there", async () => {
    const layout = browser()
    const reply = answer()

    network.use(turns([]), reply.handler, resolve)
    show("Life expectancy in Brazil")
    await findStep("Thinking…")
    layout.measure()
    layout.resize()
    await vi.waitFor(async () => expect(await layout.top("Life expectancy in Brazil")).toBe(24))

    reply.send(message(searched))
    await findStep("Searched for “life expectancy”: 1 found")
    layout.resize()
    expect(await layout.top("Life expectancy in Brazil")).toBe(24)

    reply.send(message(charted(plot(brazil), said("Life expectancy in Brazil rose."))))
    reply.end()
    await screen.findByRole("button", { name: /^Worked/ })
    layout.resize()
    expect(await layout.top("Life expectancy in Brazil")).toBe(24)
  })

  it("follows an answer taller than the viewport to its end, until the reader scrolls up", async () => {
    const layout = browser()
    const reply = answer()
    const user = userEvent.setup()

    network.use(turns([brazilAnswer]), reply.handler, resolve)
    layout.heights[0] = 700
    show()
    await screen.findByText("Life expectancy in Brazil rose.")
    const viewport = layout.measure()

    await user.type(await findComposer(), "And in Mexico?")
    await user.click(screen.getByRole("button", { name: "Send" }))
    await vi.waitFor(async () => expect(await layout.top("And in Mexico?")).toBe(24))
    // Browsers fire a scroll event once the question lands.
    fireEvent.scroll(viewport)

    reply.send(message(rendering(plot(mexico), 0)))
    await screen.findByRole("heading", { name: "Life expectancy at birth (years)" })
    layout.heights[1] = 2000
    layout.resize()
    // The end of the answer shows above the composer.
    await vi.waitFor(() => expect(viewport.scrollTop).toBe(viewport.scrollHeight - 600))
    fireEvent.scroll(viewport)

    fireEvent.scroll(viewport, { target: { scrollTop: 900 } })
    layout.heights[1] = 2600
    layout.resize()
    expect(viewport.scrollTop).toBe(900)
    expect(screen.getByRole("button", { name: "Scroll to end" })).toBeDefined()
    reply.end()
  })

  it("sends with Enter and starts a new line with Shift+Enter", async () => {
    const reply = answer()
    const user = userEvent.setup()

    network.use(
      turns([
        {
          question: "Life expectancy in Brazil",
          answer: charted(plot(brazil)),
        },
      ]),
      reply.handler,
      resolve,
    )
    show()

    await user.type(line(await findComposer()), "Add Mexico{Shift>}{Enter}{/Shift}per person")
    expect(typed(await findComposer())).toBe("Add Mexico\nper person")

    await user.keyboard("{Enter}")

    expect(
      await findQuestion("Add Mexico\nper person", {
        normalizer: getDefaultNormalizer({ collapseWhitespace: false }),
      }),
    ).toBeDefined()
    expect(typed(await findComposer())).toBe("")

    reply.send(message(Unanswered.make({})))
    reply.end()

    expect(await screen.findByText("No World Bank indicator answers this question")).toBeDefined()
    expect((await findComposer()).getAttribute("aria-placeholder")).toBe(
      "Name what to measure and where",
    )
  })

  it.each([
    ["Cmd+Enter", "{Meta>}{Enter}{/Meta}"],
    ["Ctrl+Enter", "{Control>}{Enter}{/Control}"],
  ])("sends with %s", async (_, keys) => {
    const reply = answer()
    const user = userEvent.setup()

    network.use(turns([]), reply.handler, resolve)
    show()

    await user.type(line(await findComposer()), "Life expectancy in Chile")
    await user.keyboard(keys)

    expect(await findQuestion("Life expectancy in Chile")).toBeDefined()
    expect(typed(await findComposer())).toBe("")

    reply.send(message(Unanswered.make({})))
    reply.end()

    expect(await screen.findByText("No World Bank indicator answers this question")).toBeDefined()
  })

  it("says why a question too short to send cannot be sent", async () => {
    const user = userEvent.setup()

    network.use(turns([]))
    show()

    await user.type(line(await findComposer()), "Hi{Enter}")

    expect(
      screen
        .getByRole("button", { name: "Type a longer question to send" })
        .getAttribute("aria-disabled"),
    ).toBe("true")
    expect(typed(await findComposer())).toBe("Hi")
  })

  it("stops an answer in progress and is ready for the next question", async () => {
    const reply = answer()
    const user = userEvent.setup()

    network.use(
      turns([]),
      reply.handler,
      // The server stops the answer and the step running, then ends its
      // stream with Stopped.
      http.delete(`/api/conversations/${id}/answer`, () => {
        reply.send(message(searching(Stopped.make({}))))
        reply.send(message(Stopped.make({})))
        reply.end()

        return new HttpResponse(null, { status: 204 })
      }),
    )
    show("Life expectancy in Brazil")

    reply.send(message(searching()))
    expect(await findStep("Searching for “life expectancy”…")).toBeDefined()

    // A draft takes the stop button's place until the box is empty again.
    await user.type(await findComposer(), "Add Mexico")
    expect(
      screen.getByRole("button", { name: "Wait for the answer to send another question" }),
    ).toBeDefined()
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull()

    await user.type(await findComposer(), "{Backspace>10/}")
    await user.click(screen.getByRole("button", { name: "Stop" }))

    expect(await screen.findByText("You stopped")).toBeDefined()
    expect(await findQuestion("Life expectancy in Brazil")).toBeDefined()
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull()

    const composer = await findComposer()

    expect(document.activeElement).toBe(composer)
    expect(composer.getAttribute("aria-placeholder")).toBe("Ask again, or ask something else")

    await user.click(screen.getByRole("button", { name: "Worked · 1 search" }))
    expect(await findStep("Stopped searching for “life expectancy”")).toBeDefined()

    await user.type(composer, "Life expectancy in Mexico")
    expect(screen.getByRole("button", { name: "Send" }).getAttribute("aria-disabled")).not.toBe(
      "true",
    )
  })

  it("shows each block as soon as the agent sends it, and keeps them when the answer stops", async () => {
    const reply = answer()
    const user = userEvent.setup()
    const rose = "Life expectancy in Brazil rose."

    network.use(
      turns([]),
      reply.handler,
      resolve,
      // The server stops the answer, which keeps the chart drawn so far.
      http.delete(`/api/conversations/${id}/answer`, () => {
        reply.send(message(Stopped.make({ blocks: [plot(brazil), said(rose)] })))
        reply.end()

        return new HttpResponse(null, { status: 204 })
      }),
    )
    show("Life expectancy in Brazil, and its change")

    reply.send(message(rendering(plot(brazil), 0)))

    const drawn = await screen.findByRole("region", { name: "Chart 1 of the answer" })

    expect(await within(drawn).findByText("Brazil · 2000–2001")).toBeDefined()
    // The agent's words say what its own chart shows.
    expect(within(drawn).queryByRole("button", { name: "Explain this chart" })).toBeNull()
    expect(screen.getByText(/^Working for/)).toBeDefined()

    reply.send(message(rendering(said(rose), 1)))

    expect(await screen.findByText(rose)).toBeDefined()
    // Screen readers hear the chart once, not each time it changes.
    expect(
      within(screen.getByRole("log", { name: "Finished steps" })).getAllByText(
        "Chart 1 of the answer: Life expectancy at birth (years)",
      ),
    ).toHaveLength(1)

    await user.click(screen.getByRole("button", { name: "Stop" }))

    expect(await screen.findByText("You stopped")).toBeDefined()
    expect(screen.getByRole("region", { name: "Chart 1 of the answer" })).toBeDefined()
    expect(screen.getByText(rose)).toBeDefined()
  })

  it.each([
    { via: "click", expected: "South Korea" },
    { via: "number", expected: "North Korea" },
    { via: "reply", expected: "Both since 2010" },
  ])("sends an agent reply by $via", async ({ via, expected }) => {
    const user = userEvent.setup()
    const sent: Array<unknown> = []
    network.use(
      turns([
        {
          question: "How long do people live in Korea?",
          answer: Asked.make({ question: "Which Korea?", choices: ["South Korea", "North Korea"] }),
        },
      ]),
      http.post(`/api/conversations/${id}/questions`, async ({ request }) => {
        sent.push(await request.json())

        return new HttpResponse(message(Unanswered.make({})), {
          headers: { "content-type": "text/event-stream" },
        })
      }),
    )
    show()

    const panel = await screen.findByRole("region", { name: "Which Korea?" })
    expect(within(panel).getAllByRole("button")).toHaveLength(2)
    expect((await findComposer()).getAttribute("aria-placeholder")).toBe(
      "Pick a choice above, or say what you mean",
    )

    if (via === "click")
      await user.click(within(panel).getByRole("button", { name: "South Korea" }))

    if (via === "number") await user.keyboard("2")

    if (via === "reply") {
      await user.type(await findComposer(), "Both since 2010")
      await user.keyboard("{Enter}")
    }

    expect(await findQuestion(expected)).toBeDefined()
    expect(await screen.findByText("No World Bank indicator answers this question")).toBeDefined()
    expect(sent).toEqual([{ question: expected }])
    expect(screen.queryByRole("region", { name: "Which Korea?" })).toBeNull()
    expect(screen.queryByRole("button", { name: "South Korea" })).toBeNull()
    expect(await findQuestion("Which Korea?")).toBeDefined()
  })

  it("keeps older questions read-only and gives keyboard focus to the latest choices", async () => {
    const user = userEvent.setup()
    network.use(
      turns([
        {
          question: "Which measure?",
          answer: Asked.make({ question: "Measure to use?", choices: ["GDP"] }),
        },
        {
          question: "Life expectancy in Korea",
          answer: Asked.make({ question: "Which Korea?", choices: ["South Korea", "North Korea"] }),
        },
      ]),
    )
    show()

    const choice = await screen.findByRole("button", { name: "South Korea" })
    expect(await findQuestion("Measure to use?")).toBeDefined()
    expect(screen.queryByRole("button", { name: "GDP" })).toBeNull()
    await user.click(await findComposer())
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "North Korea" }))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(choice)
  })

  it("follows an answer still in progress when the page opens", async () => {
    const reply = answer("follow")

    network.use(
      turns([], { question: "Life expectancy in Brazil", started }),
      reply.handler,
      resolve,
    )
    show()

    expect(await findQuestion("Life expectancy in Brazil")).toBeDefined()
    expect((await findComposer()).getAttribute("aria-placeholder")).toBe(
      "Write your next question while civicdata answers",
    )

    // A draft waits: Enter and Cmd+Enter send nothing while the agent answers.
    const user = userEvent.setup()

    await user.type(line(await findComposer()), "And in Chile?{Enter}")
    expect(typed(await findComposer())).toBe("And in Chile?")
    await user.keyboard("{Meta>}{Enter}{/Meta}")
    expect(typed(await findComposer())).toBe("And in Chile?")
    expect(
      screen
        .getByRole("button", { name: "Wait for the answer to send another question" })
        .getAttribute("aria-disabled"),
    ).toBe("true")

    reply.send(message(searching()))
    expect(await findStep("Searching for “life expectancy”…")).toBeDefined()

    reply.send(message(charted(plot(brazil))))
    reply.end()

    expect(
      await screen.findByRole("heading", { name: "Life expectancy at birth (years)" }),
    ).toBeDefined()
  })

  it("picks the answer up again when the connection drops mid-answer", async () => {
    const asked = answer()
    const resumed = answer("follow")
    let answering: Turns["answering"]

    network.use(
      http.get(`/api/conversations/${id}`, () =>
        HttpResponse.json(
          encodeTurns(answering === undefined ? { answered: [] } : { answered: [], answering }),
        ),
      ),
      asked.handler,
      resumed.handler,
      resolve,
    )
    show("Life expectancy in Brazil")

    asked.send(message(searching()))
    expect(await findStep("Searching for “life expectancy”…")).toBeDefined()

    // The server keeps answering after the page loses the stream.
    answering = { question: "Life expectancy in Brazil", started }
    asked.cut()

    resumed.send(message(searching()))
    resumed.send(message(charted(plot(brazil))))
    resumed.end()

    expect(
      await screen.findByRole("heading", { name: "Life expectancy at birth (years)" }),
    ).toBeDefined()
    expect(screen.queryByText("The question could not be sent")).toBeNull()
  })

  it.each([
    { error: new AgentUnavailable(), title: "The assistant is not available" },
    { error: new SourceUnavailable({ source: "Eurostat" }), title: "Eurostat is not responding" },
    { error: new CatalogUnavailable(), title: "Indicator search is not available" },
  ])("keeps $title under its question", async ({ error, title }) => {
    const reply = answer()
    network.use(turns([]), reply.handler)
    show("Life expectancy in Brazil")
    reply.send(failure(error))
    reply.end()

    const alert = await screen.findByRole("alert")
    expect(within(alert).getByText(title)).toBeDefined()
    expect(within(alert).getByRole("button", { name: "Ask again" })).toBeDefined()
    expect(await findQuestion("Life expectancy in Brazil")).toBeDefined()
    expect(screen.queryByRole("button", { name: "Dismiss error" })).toBeNull()
  })

  it("explains a busy conversation", async () => {
    network.use(
      turns([]),
      http.post(`/api/conversations/${id}/questions`, () =>
        HttpResponse.json(Schema.encodeSync(ConversationBusy)(new ConversationBusy()), {
          status: 409,
        }),
      ),
    )
    show("Life expectancy in Brazil")
    expect(await screen.findByText("Still answering an earlier question")).toBeDefined()
    expect(screen.getByRole("button", { name: "Ask again" })).toBeDefined()
  })

  it("dismisses a conversation loading failure above the timeline", async () => {
    network.use(
      http.get(`/api/conversations/${id}`, () =>
        HttpResponse.json(Schema.encodeSync(AgentUnavailable)(new AgentUnavailable()), {
          status: 503,
        }),
      ),
    )
    show()
    const alert = await screen.findByRole("alert")
    expect(within(alert).getByText("The assistant is not available")).toBeDefined()
    expect(
      within(screen.getByRole("list", { name: "Questions and answers" })).queryByRole("alert"),
    ).toBeNull()
    expect(screen.queryByRole("button", { name: "Ask again" })).toBeNull()
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Dismiss error" }))
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("asks the exact failed question again and shows its answer", async () => {
    const question = "Life expectancy in Brazil"
    const sent: unknown[] = []
    network.use(
      turns([]),
      resolve,
      http.post(`/api/conversations/${id}/questions`, async ({ request }) => {
        sent.push(await request.json())

        return events(
          sent.length === 1 ? failure(new AgentUnavailable()) : message(charted(plot(brazil))),
        )
      }),
    )
    show(question)
    await userEvent.setup().click(await screen.findByRole("button", { name: "Ask again" }))
    expect(
      await screen.findByRole("heading", { name: "Life expectancy at birth (years)" }),
    ).toBeDefined()
    expect(sent).toEqual([{ question }, { question }])
    expect(screen.queryByRole("alert")).toBeNull()
    expect(await screen.findAllByText(question, { selector: "p" })).toHaveLength(1)
  })

  it("keeps earlier failed questions when another question is asked", async () => {
    network.use(
      turns([]),
      http.post(`/api/conversations/${id}/questions`, () =>
        events(failure(new AgentUnavailable())),
      ),
    )
    show("Life expectancy in Brazil")
    await screen.findByRole("button", { name: "Ask again" })
    const user = userEvent.setup()
    await user.type(await findComposer(), "And in Chile?{Enter}")
    expect(await screen.findAllByRole("alert")).toHaveLength(2)
    expect(await findQuestion("Life expectancy in Brazil")).toBeDefined()
    expect(await findQuestion("And in Chile?")).toBeDefined()
  })

  it("counts down before offering to ask a rate-limited question again", async () => {
    network.use(
      turns([]),
      http.post(`/api/conversations/${id}/questions`, () =>
        HttpResponse.json(Schema.encodeSync(TooManyQuestions)(new TooManyQuestions()), {
          status: 429,
        }),
      ),
    )
    show("Life expectancy in Brazil")
    expect(await screen.findByText("Too many questions in a minute")).toBeDefined()
    expect(screen.getByText("Ask again in 60 seconds.")).toBeDefined()
    expect(screen.queryByRole("button", { name: "Ask again" })).toBeNull()
    vi.useFakeTimers({ toFake: ["Date"] })

    try {
      vi.setSystemTime(Date.now() + 60_000)
      expect(
        await screen.findByRole("button", { name: "Ask again" }, { timeout: 2000 }),
      ).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it("says an empty conversation has no questions", async () => {
    network.use(turns([]))
    show()

    expect(await screen.findByText(/No questions yet/)).toBeDefined()
  })
})
