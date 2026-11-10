import {
  Answered,
  Chart,
  Asked,
  ConversationId,
  ConversationNotFound,
  IndicatorId,
  Step,
  Stopped,
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
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DateTime, Option, Schema } from "effect"
import { http, HttpResponse } from "msw/http"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Conversation } from "@/conversation/Conversation"

import { network } from "../../test/network.ts"
import { Layout } from "./Layout.tsx"

// Where the list is kept. Its format outlives deploys: changing it empties
// every visitor's list.
const key = "civicdata:conversations"

const brazil = ConversationId.make("0b5d7c1e-8f4a-4c2b-9d3e-1a2b3c4d5e6f")
const happiness = ConversationId.make("6a1e2f3d-4c5b-4a69-8f7e-0d1c2b3a4f5e")
const spending = ConversationId.make("3c2d1e0f-9a8b-4c7d-8e6f-5a4b3c2d1e0f")
const pensions = ConversationId.make("9f8e7d6c-5b4a-4392-a1b0-c9d8e7f6a5b4")

const minutes = (count: number) => new Date(Date.now() - count * 60_000).toISOString()

interface Stored {
  id: ConversationId
  title: string
  askedAt: string
}

const entry = (delta: Partial<Stored> = {}): Stored => ({
  id: brazil,
  title: "How has life expectancy changed in Brazil?",
  askedAt: minutes(5),
  ...delta,
})

const store = (...entries: ReadonlyArray<Stored>) =>
  localStorage.setItem(key, JSON.stringify(entries))

// The follow-up typed in a conversation and not sent yet.
const draft = (id: ConversationId) => `civicdata:draft:${id}`

const encodeTurns = Schema.encodeSync(Schema.toCodecJson(Turns))

const unanswered = (question: string): Turn => ({ question, answer: Unanswered.make({}) })

const answered = (question: string): Turn => ({
  question,
  answer: Answered.make({
    blocks: [
      Chart.make({
        view: Trend.make({
          indicator: IndicatorId.make("SP.DYN.LE00.IN"),
          countries: ["BRA"],
          from: Year.make(2000),
          to: Year.make(2001),
        }),
      }),
    ],
  }),
})

const turns = (id: ConversationId, value: Turns) =>
  http.get(`/api/conversations/${id}`, () => HttpResponse.json(encodeTurns(value)))

const notFound = () =>
  HttpResponse.json(Schema.encodeSync(ConversationNotFound)(new ConversationNotFound()), {
    status: 404,
  })

// A conversation the server does not have: never asked in, or deleted.
const missing = (id: ConversationId) => http.get(`/api/conversations/${id}`, notFound)

const encodeStep = Schema.encodeSync(Schema.fromJsonString(Schema.toCodecJson(Step)))

// An answer the test ends when it wants, to a question asked in `id`.
const answer = (id: ConversationId) => {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined

  const body = new ReadableStream<Uint8Array>({
    start: (opened) => {
      controller = opened
    },
  })

  return {
    handler: http.post(
      `/api/conversations/${id}/questions`,
      () => new HttpResponse(body, { headers: { "content-type": "text/event-stream" } }),
    ),
    unanswered: () => {
      controller?.enqueue(
        encoder.encode(`event: message\ndata: ${encodeStep(Unanswered.make({}))}\n\n`),
      )
      controller?.close()
    },
  }
}

const blocked = () => {
  throw new DOMException("The operation is insecure.", "SecurityError")
}

const decodeId = Schema.decodeUnknownOption(ConversationId)

// The app's pages inside the real layout: a stand-in home page, and the real
// conversation page.
const show = (path = "/") => {
  const root = createRootRoute({ component: Outlet })

  const layout = createRoute({
    getParentRoute: () => root,
    id: "chat",
    component: () => (
      <Layout>
        <Outlet />
      </Layout>
    ),
  })

  const home = createRoute({
    getParentRoute: () => layout,
    path: "/",
    component: () => <main>Home</main>,
  })

  const conversation = createRoute({
    getParentRoute: () => layout,
    path: "/c/$id",
    component: function Page() {
      const { id } = conversation.useParams()

      return Option.match(decodeId(id), {
        onNone: () => null,
        onSome: (valid) => <Conversation id={valid} first={undefined} />,
      })
    },
  })

  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider
        router={createRouter({
          routeTree: root.addChildren([layout.addChildren([home, conversation])]),
          history: createMemoryHistory({ initialEntries: [path] }),
        })}
      />
    </QueryClientProvider>,
  )
}

const sidebar = async () => within(await screen.findByRole("navigation", { name: "Conversations" }))

// The sidebar's row for the conversation about life expectancy.
const row = async () => (await sidebar()).findByRole("link", { name: /Life expectancy/ })

beforeEach(() => localStorage.clear())

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("History", () => {
  it("says where conversations will be listed before there are any", async () => {
    show()

    expect(
      (await sidebar()).getByText(
        "The conversations you start are listed here, in this browser only.",
      ),
    ).toBeDefined()
    expect(screen.getByRole("link", { name: "New conversation" }).getAttribute("href")).toBe("/")
  })

  it("links to the source on GitHub", async () => {
    show()

    expect(
      (await screen.findByRole("link", { name: "View the source on GitHub" })).getAttribute("href"),
    ).toBe("https://github.com/nicolastoulemont/civicdata")
  })

  it("lists this browser's conversations newest first, with how long ago each was asked", async () => {
    store(
      entry({ id: happiness, title: "Which countries are happiest?", askedAt: minutes(3 * 60) }),
      entry(),
    )
    network.use(
      turns(brazil, { answered: [unanswered("How has life expectancy changed in Brazil?")] }),
      turns(happiness, { answered: [unanswered("Which countries are happiest?")] }),
    )
    show()

    const links = (await sidebar()).getAllByRole("link")

    await waitFor(() =>
      expect(links.map((link) => link.textContent)).toEqual([
        "How has life expectancy changed in Brazil?No data5m",
        "Which countries are happiest?No data3h",
      ]),
    )
    expect(links[0]?.getAttribute("href")).toBe(`/c/${brazil}`)
  })

  it("marks the open conversation as the current page", async () => {
    store(entry())
    network.use(
      turns(brazil, { answered: [unanswered("How has life expectancy changed in Brazil?")] }),
    )
    show(`/c/${brazil}`)

    const link = (await sidebar()).getByRole("link", {
      name: /How has life expectancy changed in Brazil/,
    })

    await waitFor(() => expect(link.getAttribute("aria-current")).toBe("page"))
  })

  it("lists a conversation as its first question is asked, working until it is answered", async () => {
    const user = userEvent.setup()
    const reply = answer(brazil)

    network.use(turns(brazil, { answered: [] }), reply.handler)
    show(`/c/${brazil}`)

    await user.type(
      await screen.findByRole("textbox", { name: "Ask a follow-up" }),
      "Life expectancy in Brazil",
    )
    await user.click(screen.getByRole("button", { name: "Send" }))

    const link = await (await sidebar()).findByRole("link", { name: /Life expectancy in Brazil/ })

    expect(within(link).getByText("Working")).toBeDefined()
    expect(within(link).getByText("now")).toBeDefined()

    reply.unanswered()

    expect(await within(link).findByText("No data")).toBeDefined()
    expect(within(link).queryByText("Working")).toBeNull()
    expect((await sidebar()).getByRole("link", { name: /Life expectancy in Brazil/ })).toBe(link)
  })

  it("keeps the first question as the title when a follow-up is asked", async () => {
    const user = userEvent.setup()
    const reply = answer(brazil)

    store(entry({ title: "Life expectancy in Brazil", askedAt: minutes(60) }))
    network.use(
      turns(brazil, { answered: [unanswered("Life expectancy in Brazil")] }),
      reply.handler,
    )
    show(`/c/${brazil}`)

    await user.type(
      await screen.findByRole("textbox", { name: "Ask a follow-up" }),
      "What about Mexico?",
    )
    await user.click(screen.getByRole("button", { name: "Send" }))
    reply.unanswered()

    const list = await sidebar()

    await waitFor(() =>
      expect(list.getAllByRole("link").map((link) => link.textContent)).toEqual([
        "Life expectancy in BrazilNo datanow",
      ]),
    )
  })

  it("shows a conversation the server is still answering as working", async () => {
    store(entry())
    network.use(
      turns(brazil, {
        answered: [],
        answering: {
          question: "How has life expectancy changed in Brazil?",
          started: DateTime.makeUnsafe("2026-11-09T12:00:00Z"),
        },
      }),
    )
    show()

    const link = (await sidebar()).getByRole("link", { name: /life expectancy changed/ })

    expect(await within(link).findByText("Working")).toBeDefined()
  })

  it("keeps a conversation working after its page closes mid-answer, until the server answers", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const question = "Life expectancy in Brazil"
    const { promise: dropped, resolve: drop } = Promise.withResolvers<void>()

    // The conversation as the server reports it before the question, while
    // it answers, and once it has answered.
    const reports: Record<"idle" | "answering" | "done", Turns> = {
      idle: { answered: [] },
      answering: {
        answered: [],
        answering: { question, started: DateTime.makeUnsafe("2026-11-09T12:00:00Z") },
      },
      done: { answered: [unanswered(question)] },
    }

    let server: keyof typeof reports = "idle"

    network.use(
      http.get(`/api/conversations/${brazil}`, () =>
        HttpResponse.json(encodeTurns(reports[server])),
      ),
      // The server answers until the test says it is done, whether the page
      // reads the answer or not.
      http.post(`/api/conversations/${brazil}/questions`, () => {
        server = "answering"

        return new HttpResponse(new ReadableStream({ cancel: () => drop() }), {
          headers: { "content-type": "text/event-stream" },
        })
      }),
    )
    show(`/c/${brazil}`)

    await user.type(await screen.findByRole("textbox", { name: "Ask a follow-up" }), question)
    await user.click(screen.getByRole("button", { name: "Send" }))

    expect(within(await row()).getByText("Working")).toBeDefined()

    await user.click(screen.getByRole("link", { name: "New conversation" }))
    expect(await screen.findByText("Home")).toBeDefined()
    await dropped
    await vi.advanceTimersByTimeAsync(5000)

    expect(within(await row()).getByText("Working")).toBeDefined()

    server = "done"
    await vi.advanceTimersByTimeAsync(5000)

    expect(await within(await row()).findByText("No data")).toBeDefined()
  })

  it("turns a working conversation to answered once the server reports the answer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    store(entry())

    let done = false

    network.use(
      http.get(`/api/conversations/${brazil}`, () =>
        HttpResponse.json(
          encodeTurns(
            done
              ? { answered: [answered("How has life expectancy changed in Brazil?")] }
              : {
                  answered: [],
                  answering: {
                    question: "How has life expectancy changed in Brazil?",
                    started: DateTime.makeUnsafe("2026-11-09T12:00:00Z"),
                  },
                },
          ),
        ),
      ),
    )
    show()

    const link = (await sidebar()).getByRole("link", { name: /life expectancy changed/ })

    expect(await within(link).findByText("Working")).toBeDefined()

    done = true
    await vi.advanceTimersByTimeAsync(5000)

    expect(await within(link).findByText("Answered")).toBeDefined()
    expect(within(link).queryByText("Working")).toBeNull()
  })

  it("shows how each conversation's last answer ended", async () => {
    store(
      entry(),
      entry({ id: happiness, title: "Which countries are happiest?" }),
      entry({ id: spending, title: "How much do governments spend?" }),
      entry({ id: pensions, title: "Pension spending in France" }),
    )
    network.use(
      turns(brazil, { answered: [answered("How has life expectancy changed in Brazil?")] }),
      turns(happiness, {
        answered: [
          {
            question: "Which countries are happiest?",
            answer: Asked.make({
              question: "Happiest by which measure?",
              choices: ["Life satisfaction", "Positive emotions"],
            }),
          },
        ],
      }),
      turns(spending, { answered: [unanswered("How much do governments spend?")] }),
      turns(pensions, {
        answered: [{ question: "Pension spending in France", answer: Stopped.make({}) }],
      }),
    )
    show()

    const list = await sidebar()

    const status = async (name: RegExp, word: string) =>
      within(list.getByRole("link", { name })).findByText(word)

    expect(await status(/life expectancy changed/, "Answered")).toBeDefined()
    expect(await status(/happiest/, "Your reply")).toBeDefined()
    expect(await status(/governments spend/, "No data")).toBeDefined()
    expect(await status(/Pension spending/, "Stopped")).toBeDefined()
  })

  it("shows the full title in a tooltip on hover and on keyboard focus", async () => {
    const user = userEvent.setup()

    const title =
      "What share of public spending goes to pensions in France, Germany and Italy since 1995?"

    store(entry({ title }))
    network.use(turns(brazil, { answered: [unanswered(title)] }))
    show()

    const link = (await sidebar()).getByRole("link", { name: /share of public spending/ })

    await user.hover(link)

    expect((await screen.findByRole("tooltip")).textContent).toBe(title)

    await user.unhover(link)
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull())

    // The sidebar's toggle, then "New conversation", then the conversation.
    await user.tab()
    await user.tab()
    await user.tab()

    expect(document.activeElement).toBe(link)
    expect((await screen.findByRole("tooltip")).textContent).toBe(title)
  })

  it("drops a conversation the server has deleted, and its draft", async () => {
    store(entry({ id: happiness, title: "Which countries are happiest?" }), entry())
    localStorage.setItem(draft(brazil), "And in Chile?")
    network.use(
      missing(brazil),
      turns(happiness, { answered: [unanswered("Which countries are happiest?")] }),
    )
    show()

    const list = await sidebar()

    await waitFor(() =>
      expect(list.queryByRole("link", { name: /life expectancy changed/ })).toBeNull(),
    )
    expect(list.getByRole("link", { name: /Which countries are happiest/ })).toBeDefined()
    expect(localStorage.getItem(key)).not.toContain(brazil)
    expect(localStorage.getItem(draft(brazil))).toBeNull()
  })

  it("keeps a conversation whose first question failed, and its draft", async () => {
    store(entry())
    localStorage.setItem(draft(brazil), "And in Chile?")
    network.use(turns(brazil, { answered: [] }))
    show()

    const link = (await sidebar()).getByRole("link", { name: /life expectancy changed/ })

    expect(await within(link).findByText("Not answered")).toBeDefined()
    expect(localStorage.getItem(key)).toContain(brazil)
    expect(localStorage.getItem(draft(brazil))).toBe("And in Chile?")
  })

  it("keeps listing a conversation while its first question fails", async () => {
    const user = userEvent.setup()
    let asked = false

    // The server keeps a conversation from its first question on, even one
    // over the limit.
    network.use(
      http.get(`/api/conversations/${brazil}`, () =>
        asked ? HttpResponse.json(encodeTurns({ answered: [] })) : notFound(),
      ),
      http.post(`/api/conversations/${brazil}/questions`, () => {
        asked = true

        return HttpResponse.json(Schema.encodeSync(TooManyQuestions)(new TooManyQuestions()), {
          status: 429,
        })
      }),
    )
    show(`/c/${brazil}`)

    await user.type(
      await screen.findByRole("textbox", { name: "Ask a follow-up" }),
      "Life expectancy in Brazil",
    )
    await user.click(screen.getByRole("button", { name: "Send" }))

    expect(await screen.findByText("Too many questions in a minute")).toBeDefined()

    const link = (await sidebar()).getByRole("link", { name: /Life expectancy in Brazil/ })

    expect(await within(link).findByText("Not answered")).toBeDefined()
    expect(localStorage.getItem(key)).toContain(brazil)
  })

  it("opens as a drawer on phones, and closes once a conversation is picked", async () => {
    const user = userEvent.setup()

    vi.spyOn(window, "innerWidth", "get").mockReturnValue(390)
    store(entry({ id: happiness, title: "Which countries are happiest?" }), entry())
    network.use(
      turns(brazil, { answered: [unanswered("How has life expectancy changed in Brazil?")] }),
      turns(happiness, { answered: [unanswered("Which countries are happiest?")] }),
    )
    show(`/c/${brazil}`)

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "How has life expectancy changed in Brazil?",
      }),
    ).toBeDefined()
    expect(screen.queryByRole("navigation", { name: "Conversations" })).toBeNull()

    await user.click(screen.getByRole("button", { name: "Toggle sidebar" }))

    const drawer = await screen.findByRole("dialog", { name: "Conversations" })

    await user.click(within(drawer).getByRole("link", { name: /Which countries are happiest/ }))

    expect(
      await screen.findByRole("heading", { level: 1, name: "Which countries are happiest?" }),
    ).toBeDefined()
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("starts an empty list when what is stored cannot be read", async () => {
    localStorage.setItem(key, `[{"id":"not a conversation"}]`)
    show()

    expect(
      (await sidebar()).getByText(
        "The conversations you start are listed here, in this browser only.",
      ),
    ).toBeDefined()
  })

  it("still answers when the browser blocks storage", async () => {
    const user = userEvent.setup()
    const reply = answer(brazil)

    // As in browsers that block site data: reading localStorage throws.
    vi.spyOn(window, "localStorage", "get").mockImplementation(blocked)
    network.use(turns(brazil, { answered: [] }), reply.handler)
    show(`/c/${brazil}`)

    await user.type(
      await screen.findByRole("textbox", { name: "Ask a follow-up" }),
      "Life expectancy in Brazil",
    )
    await user.click(screen.getByRole("button", { name: "Send" }))
    reply.unanswered()

    expect(await screen.findByText("No World Bank indicator answers this question")).toBeDefined()
    expect(
      (await sidebar()).getByText(
        "The conversations you start are listed here, in this browser only.",
      ),
    ).toBeDefined()
  })
})
