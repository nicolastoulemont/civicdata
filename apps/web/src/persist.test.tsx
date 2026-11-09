import {
  Answered,
  ConversationId,
  IndicatorId,
  ResolvedView,
  Searched,
  Trend,
  type Turn,
  Turns,
  Year,
} from "@civicdata/domain"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import { DateTime, Duration, Schema } from "effect"
import { http, HttpResponse } from "msw/http"
import { describe, expect, it, onTestFinished } from "vitest"

import { SidebarProvider } from "@/components/ui/sidebar"
import { Conversation } from "@/conversation/Conversation"

import { network } from "../test/network.ts"
import { persist, type Store } from "./persist.ts"

const id = ConversationId.make("0b5d7c1e-8f4a-4c2b-9d3e-1a2b3c4d5e6f")

const lifeExpectancy = IndicatorId.make("SP.DYN.LE00.IN")

const brazil = Trend.make({
  indicator: lifeExpectancy,
  countries: ["BRA"],
  from: Year.make(2000),
  to: Year.make(2001),
})

// A turn with its work log, which a restored conversation keeps.
const charted: Turn = {
  question: "How has life expectancy changed in Brazil?",
  answer: Answered.make({ view: brazil, takeaway: "Life expectancy in Brazil rose." }),
  steps: [Searched.make({ text: "life expectancy" })],
  took: Duration.seconds(8),
}

const resolve = http.post("/api/views/resolve", () =>
  HttpResponse.json(
    Schema.encodeSync(ResolvedView)({
      view: brazil,
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
  ),
)

const encodeTurns = Schema.encodeSync(Schema.toCodecJson(Turns))

const turns = (value: Turns) =>
  http.get(`/api/conversations/${id}`, () => HttpResponse.json(encodeTurns(value)))

// A request for the turns that gets no answer until the test sends one or
// ends, and whether it was sent.
const hanging = () => {
  const sent = { turns: false }
  const { promise, resolve: reply } = Promise.withResolvers<Response>()

  onTestFinished(() => reply(new HttpResponse(null, { status: 503 })))

  return {
    sent,
    handler: http.get(`/api/conversations/${id}`, () => {
      sent.turns = true

      return promise
    }),
    reply: (value: Turns) => reply(HttpResponse.json(encodeTurns(value))),
  }
}

// An answer in progress that ends with the test.
const following = () =>
  http.get(`/api/conversations/${id}/answer`, () => {
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => onTestFinished(() => controller.close()),
    })

    return new HttpResponse(body, { headers: { "content-type": "text/event-stream" } })
  })

// IndexedDB, held in memory.
const memory = () => {
  const values = new Map<string, unknown>()

  const store: Store = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
    entries: () => [...values],
  }

  return { store, values }
}

const blocked = () => {
  throw new DOMException("The operation is insecure.", "SecurityError")
}

// A page load: a new query cache over what this browser saved.
const show = (store: Store) => {
  const queryClient = new QueryClient()

  persist(queryClient, store)

  const root = createRootRoute({
    component: () => (
      <SidebarProvider>
        <Conversation id={id} first={undefined} />
      </SidebarProvider>
    ),
  })

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createRouter({ routeTree: root, history: createMemoryHistory() })} />
    </QueryClientProvider>,
  )
}

const timeline = async () =>
  within(await screen.findByRole("list", { name: "Questions and answers" }))

const findChart = () => screen.findByRole("heading", { name: "Life expectancy at birth (years)" })

describe("persist", () => {
  it("shows a conversation opened before while the network hangs, then asks for anything newer", async () => {
    const { store, values } = memory()

    network.use(turns({ answered: [charted] }), resolve)
    show(store)
    await findChart()
    await waitFor(() => expect(values.size).toBe(2))
    cleanup()

    // No chart handler: a request for the chart fails the test.
    const reload = hanging()

    network.use(reload.handler)
    show(store)

    expect(await findChart()).toBeDefined()
    expect((await timeline()).getByText("How has life expectancy changed in Brazil?")).toBeDefined()
    expect(screen.getByText("Life expectancy in Brazil rose.")).toBeDefined()
    expect(screen.getByRole("button", { name: "Worked for 8s" })).toBeDefined()
    expect(
      screen.getByText(
        "Source: World Bank, World Development Indicators. Retrieved 8 November 2026.",
      ),
    ).toBeDefined()
    await waitFor(() => expect(reload.sent.turns).toBe(true))
  })

  it("loads from the network when a saved conversation has an older shape", async () => {
    const { store, values } = memory()

    network.use(turns({ answered: [charted] }), resolve)
    show(store)
    await findChart()
    await waitFor(() => expect(values.size).toBe(2))
    cleanup()

    for (const [key, value] of values) {
      values.set(key, String(value).replace('"answered"', '"turns"'))
    }

    const reload = hanging()

    network.use(reload.handler, resolve)
    show(store)
    await waitFor(() => expect(reload.sent.turns).toBe(true))
    expect(screen.queryByText("How has life expectancy changed in Brazil?")).toBeNull()

    reload.reply({ answered: [charted] })

    expect(await findChart()).toBeDefined()
    expect((await timeline()).getByText("How has life expectancy changed in Brazil?")).toBeDefined()
  })

  it("loads from the network when the browser blocks storage", async () => {
    network.use(turns({ answered: [charted] }), resolve)
    show({ getItem: blocked, setItem: blocked, removeItem: blocked, entries: blocked })

    expect(await findChart()).toBeDefined()
  })

  it("does not restore a conversation that was being answered", async () => {
    const { store } = memory()

    network.use(
      turns({
        answered: [charted],
        answering: { question: "And in Chile?", started: DateTime.nowUnsafe() },
      }),
      following(),
      resolve,
    )
    show(store)
    expect(await (await timeline()).findByText("And in Chile?")).toBeDefined()
    cleanup()

    const reload = hanging()

    network.use(reload.handler, resolve)
    show(store)

    await waitFor(() => expect(reload.sent.turns).toBe(true))
    expect(screen.queryByText("How has life expectancy changed in Brazil?")).toBeNull()
  })
})
