import { ConversationId, Step, Turn, Turns, Unanswered } from "@civicdata/domain"
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

const encodeTurns = Schema.encodeSync(Schema.toCodecJson(Turns))

const unanswered = (question: string): Turn => ({ question, answer: Unanswered.make({}) })

const turns = (id: ConversationId, value: Turns) =>
  http.get(`/api/conversations/${id}`, () => HttpResponse.json(encodeTurns(value)))

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

beforeEach(() => localStorage.clear())

afterEach(() => vi.restoreAllMocks())

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

    expect(links.map((link) => link.textContent)).toEqual([
      "How has life expectancy changed in Brazil?5m",
      "Which countries are happiest?3h",
    ])
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

  it("lists a conversation as its first question is asked, with a dot until it is answered", async () => {
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

    expect(within(link).getByText("Answering")).toBeDefined()
    expect(within(link).getByText("now")).toBeDefined()

    reply.unanswered()

    await waitFor(() => expect(within(link).queryByText("Answering")).toBeNull())
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
        "Life expectancy in Brazilnow",
      ]),
    )
  })

  it("shows a dot while the server is still answering a conversation", async () => {
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

    expect(await within(link).findByText("Answering")).toBeDefined()
  })

  it("drops a conversation the server has deleted", async () => {
    store(entry({ id: happiness, title: "Which countries are happiest?" }), entry())
    network.use(
      turns(brazil, { answered: [] }),
      turns(happiness, { answered: [unanswered("Which countries are happiest?")] }),
    )
    show()

    const list = await sidebar()

    await waitFor(() =>
      expect(list.queryByRole("link", { name: /life expectancy changed/ })).toBeNull(),
    )
    expect(list.getByRole("link", { name: /Which countries are happiest/ })).toBeDefined()
    expect(localStorage.getItem(key)).not.toContain(brazil)
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
