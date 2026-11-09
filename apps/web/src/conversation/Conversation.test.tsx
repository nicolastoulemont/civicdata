import {
  AgentUnavailable,
  Answered,
  Asked,
  CatalogUnavailable,
  ConversationId,
  IndicatorId,
  ResolvedView,
  Searched,
  SourceUnavailable,
  Step,
  TooManyQuestions,
  Trend,
  Turn,
  Turns,
  Unanswered,
  Year,
} from "@civicdata/domain"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Cause, DateTime, Schema } from "effect"
import { http, HttpResponse } from "msw/http"
import { describe, expect, it } from "vitest"

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
      observations: [
        { country: "BRA", year: Year.make(2000), value: 70.1 },
        { country: "BRA", year: Year.make(2001), value: 70.4 },
      ],
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

const turns = (answered: ReadonlyArray<Turn>, answering?: string) =>
  http.get(`/api/conversations/${id}`, () =>
    HttpResponse.json(
      encodeTurns(answering === undefined ? { answered } : { answered, answering }),
    ),
  )

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

const failure = (error: AgentUnavailable) =>
  `event: effect/http-api/stream/failure\ndata: ${encodeFailure(Cause.fail(error))}\n\n`

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
  const root = createRootRoute({ component: () => <Conversation id={id} first={first} /> })

  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={createRouter({ routeTree: root, history: createMemoryHistory() })} />
    </QueryClientProvider>,
  )
}

// A question in the timeline, not in the header that repeats the first one.
const findQuestion = async (text: string) =>
  within(await screen.findByRole("list", { name: "Questions and answers" })).findByText(text)

const typeFollowUp = async (text: string) => {
  const user = userEvent.setup()

  await user.type(await screen.findByRole("textbox", { name: "Ask a follow-up" }), text)
  await user.click(screen.getByRole("button", { name: "Ask" }))
}

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

    reply.send(message(Searched.make({ text: "life expectancy" })))
    expect(await screen.findByText("Searched indicators for “life expectancy”")).toBeDefined()

    reply.send(
      message(Answered.make({ view: brazil, takeaway: "Life expectancy in Brazil rose." })),
    )
    reply.end()

    expect(
      await screen.findByRole("heading", { name: "Life expectancy at birth (years)" }),
    ).toBeDefined()
    expect(screen.getByText("Life expectancy in Brazil rose.")).toBeDefined()
    expect(screen.getByRole("link", { name: "Open in the explorer" })).toBeDefined()
    expect(screen.queryByText("Searched indicators for “life expectancy”")).toBeNull()
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

  it("links an answer's chart in the explorer, and copies that link", async () => {
    const link =
      "http://localhost:3000/explore?chart=trend&indicator=SP.DYN.LE00.IN&countries=BRA&from=2000&to=2001"

    const user = userEvent.setup()

    network.use(
      turns([{ question: "Life expectancy in Brazil", answer: Answered.make({ view: brazil }) }]),
      resolve,
    )
    show()

    expect(
      (await screen.findByRole("link", { name: "Open in the explorer" })).getAttribute("href"),
    ).toBe(link.replace("http://localhost:3000", ""))

    await user.click(screen.getByRole("button", { name: "Copy link" }))

    expect(await screen.findByRole("button", { name: "Link copied" })).toBeDefined()
    expect(await navigator.clipboard.readText()).toBe(link)
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

    await typeFollowUp("What about happiness?")
    reply.send(message(Unanswered.make({})))
    reply.end()

    expect(await findQuestion("What about happiness?")).toBeDefined()
    expect(await screen.findByText("No World Bank indicator answers this question")).toBeDefined()
    // The header still names the conversation by its first question.
    expect(
      screen.getByRole("heading", { level: 1, name: "Life expectancy in Brazil" }),
    ).toBeDefined()
  })

  it("offers the choices the agent asked about, and sends the one picked", async () => {
    const reply = answer()

    network.use(
      turns([
        {
          question: "How long do people live in Brazil?",
          answer: Asked.make({
            question: "Which measure?",
            choices: ["Life expectancy", "Healthy life expectancy"],
          }),
        },
      ]),
      reply.handler,
      resolve,
    )
    show()

    expect(await screen.findByText("Which measure?")).toBeDefined()

    await userEvent.setup().click(screen.getByRole("button", { name: "Life expectancy" }))

    // The choice is the next question, and the earlier choices can no longer be picked.
    expect(await screen.findByText("Life expectancy", { selector: "p" })).toBeDefined()
    expect(
      screen.getByRole("button", { name: "Healthy life expectancy" }).hasAttribute("disabled"),
    ).toBe(true)

    reply.send(message(Answered.make({ view: brazil })))
    reply.end()

    expect(
      await screen.findByRole("heading", { name: "Life expectancy at birth (years)" }),
    ).toBeDefined()
  })

  it("follows an answer still in progress when the page opens", async () => {
    const reply = answer("follow")

    network.use(turns([], "Life expectancy in Brazil"), reply.handler, resolve)
    show()

    expect(await findQuestion("Life expectancy in Brazil")).toBeDefined()
    expect(screen.getByRole("button", { name: "Ask" }).hasAttribute("disabled")).toBe(true)

    reply.send(message(Searched.make({ text: "life expectancy" })))
    expect(await screen.findByText("Searched indicators for “life expectancy”")).toBeDefined()

    reply.send(message(Answered.make({ view: brazil })))
    reply.end()

    expect(
      await screen.findByRole("heading", { name: "Life expectancy at birth (years)" }),
    ).toBeDefined()
  })

  it("picks the answer up again when the connection drops mid-answer", async () => {
    const asked = answer()
    const resumed = answer("follow")
    let answering: string | undefined

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

    asked.send(message(Searched.make({ text: "life expectancy" })))
    expect(await screen.findByText("Searched indicators for “life expectancy”")).toBeDefined()

    // The server keeps answering after the page loses the stream.
    answering = "Life expectancy in Brazil"
    asked.cut()

    resumed.send(message(Searched.make({ text: "life expectancy" })))
    resumed.send(message(Answered.make({ view: brazil })))
    resumed.end()

    expect(
      await screen.findByRole("heading", { name: "Life expectancy at birth (years)" }),
    ).toBeDefined()
    expect(screen.queryByText("The question could not be sent")).toBeNull()
  })

  it("explains a failure during the answer", async () => {
    const reply = answer()

    network.use(turns([]), reply.handler)
    show("Life expectancy in Brazil")

    reply.send(failure(new AgentUnavailable()))
    reply.end()

    expect(await screen.findByText("The assistant is not available")).toBeDefined()
  })

  it("explains when one visitor asks too often", async () => {
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
  })

  it("says an empty conversation has no questions", async () => {
    network.use(turns([]))
    show()

    expect(await screen.findByText(/No questions yet/)).toBeDefined()
  })
})
