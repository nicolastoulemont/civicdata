import {
  AgentUnavailable,
  Answered,
  Asked,
  CatalogUnavailable,
  ConversationBusy,
  ConversationId,
  Definition,
  Ended,
  Failed,
  Fetch,
  Fetched,
  IndicatorId,
  Read,
  Rejected,
  Rejection,
  ResolvedView,
  Running,
  Search,
  Searched,
  SourceUnavailable,
  Step,
  StepId,
  Stopped,
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
import { Cause, DateTime, Duration, Schema, Struct } from "effect"
import { http, HttpResponse } from "msw/http"
import { describe, expect, it, vi } from "vitest"

import { SidebarProvider } from "@/components/ui/sidebar"

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
  // The conversations here answer with trends only.
  const view = Schema.decodeUnknownSync(Trend)(await request.json())

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

const encodeAnswered = Schema.encodeSync(Schema.toCodecJson(Answered))

const isAnswered = Schema.is(Answered)

const sameView = (left: View, right: View) =>
  JSON.stringify(Schema.encodeSync(View)(left)) === JSON.stringify(Schema.encodeSync(View)(right))

// A conversation the server keeps between page loads, with the charts people
// changed its turns to. Showing the agent's own chart changes a turn back.
const kept = (answered: ReadonlyArray<Turn>) => {
  let current = answered

  const handlers = [
    http.get(`/api/conversations/${id}`, () =>
      HttpResponse.json(encodeTurns({ answered: current })),
    ),
    http.put(`/api/conversations/${id}/turns/:turn/chart`, async ({ params, request }) => {
      const view = Schema.decodeUnknownSync(View)(await request.json())

      current = current.map((turn, index) =>
        index !== Number(params["turn"])
          ? turn
          : isAnswered(turn.answer) && sameView(turn.answer.view, view)
            ? Struct.omit(turn, ["shown"])
            : Struct.assign(turn, { shown: view }),
      )

      return new HttpResponse(null, { status: 204 })
    }),
  ]

  return { handlers, turns: () => current }
}

const brazilAnswer = {
  question: "Life expectancy in Brazil",
  answer: Answered.make({ view: brazil, takeaway: "Life expectancy in Brazil rose." }),
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

    reply.send(
      message(Answered.make({ view: brazil, takeaway: "Life expectancy in Brazil rose." })),
    )
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
          answer: Answered.make({ view: brazil }),
          steps: [searched],
          took: Duration.seconds(8),
        },
      ]
      reply.send(message(Answered.make({ view: brazil })))
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
          answer: Answered.make({ view: brazil }),
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
    const answered = JSON.stringify(encodeAnswered(Answered.make({ view: brazil })))

    // Turns as the server sends them when saved before steps had states.
    const saved = `{
      "answered": [
        { "question": "What about happiness?", "answer": { "_tag": "Unanswered" } },
        {
          "question": "Life expectancy in Brazil",
          "answer": ${answered},
          "steps": [
            { "_tag": "Searched", "text": "life expectancy" },
            { "_tag": "Rejected", "problem": "The World Bank has no values for these years." }
          ],
          "took": 65000
        }
      ]
    }`

    network.use(
      http.get(
        `/api/conversations/${id}`,
        () => new HttpResponse(saved, { headers: { "content-type": "application/json" } }),
      ),
      resolve,
    )
    show()

    const user = userEvent.setup()

    await user.click(
      await screen.findByRole("button", { name: "Worked for 1m 05s · 1 search, 1 chart" }),
    )

    expect(
      within(await screen.findByRole("list", { name: "Steps" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Searched for “life expectancy”", "Tried a chart the data can't show, trying again"])

    await user.click(
      screen.getByRole("button", { name: "Tried a chart the data can't show, trying again" }),
    )
    expect(await findStep("The World Bank has no values for these years.")).toBeDefined()
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
        { question: "Life expectancy in Brazil", answer: Answered.make({ view: brazil }) },
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
    expect(screen.getByText("Life expectancy in Brazil rose.").className).toContain(
      "text-muted-foreground",
    )
    expect(screen.getByText("This describes the chart before your changes.")).toBeDefined()
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

  it("shows who governed in an answer's chart, and says when a country has no records", async () => {
    const user = userEvent.setup()

    network.use(
      ...kept([brazilAnswer]).handlers,
      resolve,
      http.get("/api/politics", () => HttpResponse.json({ governments: [], elections: [] })),
    )
    show()

    await user.click(await screen.findByRole("button", { name: "Governments" }))

    expect(await screen.findByText("No government records for Brazil")).toBeDefined()
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
    expect(await screen.findByText("This describes the chart before your changes.")).toBeDefined()
  })

  it("goes back to the agent's chart and its takeaway, after a reload too", async () => {
    const user = userEvent.setup()
    const server = kept([brazilAnswer])

    network.use(...server.handlers, resolve)
    const page = show()

    await addArgentina(user)
    await vi.waitFor(() => expect(server.turns()[0]?.shown).toBeDefined())
    await user.click(await screen.findByRole("button", { name: "Back to the agent's chart" }))

    expect(await screen.findByText("Brazil · 2000–2001")).toBeDefined()
    expect(screen.getByText("Life expectancy in Brazil rose.").className).not.toContain(
      "text-muted-foreground",
    )
    expect(screen.queryByRole("button", { name: "Back to the agent's chart" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Explain this chart" })).toBeNull()
    await vi.waitFor(() => expect(server.turns()[0]).not.toHaveProperty("shown"))

    page.unmount()
    show()

    expect(await screen.findByText("Brazil · 2000–2001")).toBeDefined()
    expect(screen.queryByText("This describes the chart before your changes.")).toBeNull()
  })

  it("says why a change could not be kept, and shows the chart kept before", async () => {
    network.use(
      turns([brazilAnswer]),
      http.put(`/api/conversations/${id}/turns/:turn/chart`, () =>
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
      turns([{ question: "Life expectancy in Brazil", answer: Answered.make({ view: brazil }) }]),
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
      turns([{ question: "Life expectancy in Brazil", answer: Answered.make({ view: brazil }) }]),
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
      turns([{ question: "Life expectancy in Brazil", answer: Answered.make({ view: brazil }) }]),
      reply.handler,
      resolve,
    )
    show()

    expect(
      await screen.findByRole("heading", { level: 1, name: "Life expectancy in Brazil" }),
    ).toBeDefined()

    const user = userEvent.setup()

    expect((await findComposer()).getAttribute("placeholder")).toBe(
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

  it("sends with Enter and starts a new line with Shift+Enter", async () => {
    const reply = answer()
    const user = userEvent.setup()

    network.use(
      turns([{ question: "Life expectancy in Brazil", answer: Answered.make({ view: brazil }) }]),
      reply.handler,
      resolve,
    )
    show()

    await user.type(await findComposer(), "Add Mexico{Shift>}{Enter}{/Shift}per person")
    expect(await findComposer()).toHaveProperty("value", "Add Mexico\nper person")

    await user.keyboard("{Enter}")

    expect(
      await findQuestion("Add Mexico\nper person", {
        normalizer: getDefaultNormalizer({ collapseWhitespace: false }),
      }),
    ).toBeDefined()
    expect(await findComposer()).toHaveProperty("value", "")

    reply.send(message(Unanswered.make({})))
    reply.end()

    expect(await screen.findByText("No World Bank indicator answers this question")).toBeDefined()
    expect((await findComposer()).getAttribute("placeholder")).toBe(
      "Name what to measure and where",
    )
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

    await user.clear(await findComposer())
    await user.click(screen.getByRole("button", { name: "Stop" }))

    expect(await screen.findByText("You stopped")).toBeDefined()
    expect(await findQuestion("Life expectancy in Brazil")).toBeDefined()
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull()

    const composer = await findComposer()

    expect(document.activeElement).toBe(composer)
    expect(composer.getAttribute("placeholder")).toBe("Ask again, or ask something else")

    await user.click(screen.getByRole("button", { name: "Worked · 1 search" }))
    expect(await findStep("Stopped searching for “life expectancy”")).toBeDefined()

    await user.type(composer, "Life expectancy in Mexico")
    expect(screen.getByRole("button", { name: "Send" }).getAttribute("aria-disabled")).not.toBe(
      "true",
    )
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
    expect((await findComposer()).getAttribute("placeholder")).toBe(
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
    expect((await findComposer()).getAttribute("placeholder")).toBe(
      "Write your next question while civicdata answers",
    )

    // A draft waits: Enter sends nothing while the agent answers.
    await userEvent.setup().type(await findComposer(), "And in Chile?{Enter}")
    expect(await findComposer()).toHaveProperty("value", "And in Chile?")
    expect(
      screen
        .getByRole("button", { name: "Wait for the answer to send another question" })
        .getAttribute("aria-disabled"),
    ).toBe("true")

    reply.send(message(searching()))
    expect(await findStep("Searching for “life expectancy”…")).toBeDefined()

    reply.send(message(Answered.make({ view: brazil })))
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
    resumed.send(message(Answered.make({ view: brazil })))
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
          sent.length === 1
            ? failure(new AgentUnavailable())
            : message(Answered.make({ view: brazil })),
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
