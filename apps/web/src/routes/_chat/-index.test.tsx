import { ConversationId, Step, Turns, Unanswered } from "@civicdata/domain"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent, { type UserEvent } from "@testing-library/user-event"
import { Schema } from "effect"
import { http, HttpResponse } from "msw/http"
import { expect, it } from "vitest"

import { line, typed } from "../../../test/composer.ts"
import { network } from "../../../test/network.ts"
import { Route as ChatRoute } from "../_chat"
import { Route as ConversationRoute } from "./c.$id"
import { Route as HomeRoute } from "./index"

const encodeTurns = Schema.encodeSync(Schema.toCodecJson(Turns))
const encodeStep = Schema.encodeSync(Schema.fromJsonString(Schema.toCodecJson(Step)))
const decodeAsk = Schema.decodeUnknownSync(Schema.Struct({ question: Schema.String }))

// The agent finds no indicator for any question. The server saves each
// question as a turn, and records it in `asked`.
const serve = () => {
  const asked: Array<string> = []

  network.use(
    http.get("/api/conversations/:id", () =>
      HttpResponse.json(
        encodeTurns({
          answered: asked.map((question) => ({ question, answer: Unanswered.make({}) })),
        }),
      ),
    ),
    http.post("/api/conversations/:id/questions", async ({ request }) => {
      asked.push(decodeAsk(await request.json()).question)

      return new HttpResponse(`event: message\ndata: ${encodeStep(Unanswered.make({}))}\n\n`, {
        headers: { "content-type": "text/event-stream" },
      })
    }),
  )

  return asked
}

// Home and the conversation page under the chat layout, starting at `path`.
const open = (path = "/") => {
  const Chat = ChatRoute.options.component
  const Home = HomeRoute.options.component
  const Conversation = ConversationRoute.options.component

  if (Chat === undefined || Home === undefined || Conversation === undefined) {
    throw new Error("Chat routes must render their pages")
  }

  const root = createRootRoute({ component: Outlet })

  const chat = createRoute({
    id: "_chat",
    getParentRoute: () => root,
    component: Chat,
  })

  const home = createRoute({
    path: "/",
    getParentRoute: () => chat,
    component: Home,
  })

  const conversation = createRoute({
    component: Conversation,
    beforeLoad: ({ params }) => ({ id: Schema.decodeSync(ConversationId)(params.id) }),
    path: "/c/$id",
    getParentRoute: () => chat,
  })

  const router = createRouter({
    routeTree: root.addChildren([chat.addChildren([home, conversation])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return router
}

const ask = async (user: UserEvent, question: string) => {
  await user.type(await screen.findByRole("textbox", { name: "Ask about a country" }), question)
  await user.click(screen.getByRole("button", { name: "Send" }))
}

it("opens a conversation from home with the question shown and the composer ready", async () => {
  const question = "What about happiness in Brazil?"
  serve()
  const router = open()
  const user = userEvent.setup()

  await ask(user, question)

  await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/c\/[\da-f-]+$/))
  const timeline = await screen.findByRole("list", { name: "Questions and answers" })
  expect(await within(timeline).findByText(question)).toBeDefined()
  expect(await screen.findByText("No World Bank indicator answers this question")).toBeDefined()

  const composer = screen.getByRole("textbox", { name: "Ask a follow-up" })
  expect(composer.textContent).toBe("")
  await user.type(composer, "And in Chile?")
  expect(screen.getByRole("button", { name: "Send" }).getAttribute("aria-disabled")).not.toBe(
    "true",
  )
})

it("shows the saved turn without asking again when going back to a conversation", async () => {
  const question = "What about happiness in Brazil?"
  const asked = serve()
  const router = open()
  const user = userEvent.setup()

  await ask(user, question)
  expect(await screen.findByText("No World Bank indicator answers this question")).toBeDefined()

  await user.click(screen.getByRole("link", { name: "New conversation" }))
  expect(await screen.findByRole("textbox", { name: "Ask about a country" })).toBeDefined()

  act(() => router.history.back())

  const timeline = await screen.findByRole("list", { name: "Questions and answers" })
  expect(
    await within(timeline).findByText("No World Bank indicator answers this question"),
  ).toBeDefined()
  expect(within(timeline).getAllByText(question)).toHaveLength(1)
  expect(asked).toEqual([question])
})

const findHome = () => screen.findByRole("textbox", { name: "Ask about a country" })
const findFollowUp = () => screen.findByRole("textbox", { name: "Ask a follow-up" })

it("keeps the question typed on home across a reload until it is sent", async () => {
  serve()
  open()
  const user = userEvent.setup()

  await user.type(line(await findHome()), "Happiness in Brazil")

  // A reload renders the app again over the same browser storage.
  cleanup()
  open()

  expect(typed(await findHome())).toBe("Happiness in Brazil")

  await user.click(screen.getByRole("button", { name: "Send" }))
  expect(await screen.findByRole("list", { name: "Questions and answers" })).toBeDefined()

  cleanup()
  open()

  expect(typed(await findHome())).toBe("")
})

it("keeps each conversation's draft when moving between conversations", async () => {
  const first = ConversationId.make("0b5d7c1e-8f4a-4c2b-9d3e-1a2b3c4d5e6f")
  const second = ConversationId.make("6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b")
  serve()
  const router = open(`/c/${first}`)
  const user = userEvent.setup()

  await user.type(line(await findFollowUp()), "And in Chile?")

  await act(() => router.navigate({ to: "/c/$id", params: { id: second } }))
  await waitFor(async () => expect(typed(await findFollowUp())).toBe(""))

  act(() => router.history.back())
  await waitFor(async () => expect(typed(await findFollowUp())).toBe("And in Chile?"))
})

it("says how long questions are kept before the visitor asks one", async () => {
  open()

  expect(await screen.findByText(/Questions and answers are kept for a year/)).toBeDefined()
})
