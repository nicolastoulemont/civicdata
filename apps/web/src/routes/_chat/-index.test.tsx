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
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Schema } from "effect"
import { http, HttpResponse } from "msw/http"
import { afterEach, expect, it } from "vitest"

import { network } from "../../../test/network.ts"
import { Route as ChatRoute } from "../_chat"
import { Route as ConversationRoute } from "./c.$id"
import { Route as HomeRoute } from "./index"

const encodeTurns = Schema.encodeSync(Schema.toCodecJson(Turns))
const encodeStep = Schema.encodeSync(Schema.fromJsonString(Schema.toCodecJson(Step)))

afterEach(() => localStorage.clear())

it("opens a conversation from home with the question shown and the composer ready", async () => {
  const question = "What about happiness in Brazil?"
  network.use(
    http.get("/api/conversations/:id", () => HttpResponse.json(encodeTurns({ answered: [] }))),
    http.post(
      "/api/conversations/:id/questions",
      () =>
        new HttpResponse(`event: message\ndata: ${encodeStep(Unanswered.make({}))}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        }),
    ),
  )

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
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })

  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  const user = userEvent.setup()
  await user.type(await screen.findByRole("textbox", { name: "Ask about a country" }), question)
  await user.click(screen.getByRole("button", { name: "Send" }))

  await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/c\/[\da-f-]+$/))
  const timeline = await screen.findByRole("list", { name: "Questions and answers" })
  expect(await within(timeline).findByText(question)).toBeDefined()
  expect(await screen.findByText("No World Bank indicator answers this question")).toBeDefined()

  const composer = screen.getByRole("textbox", { name: "Ask a follow-up" })
  expect(composer).toHaveProperty("value", "")
  await user.type(composer, "And in Chile?")
  expect(screen.getByRole("button", { name: "Send" }).getAttribute("aria-disabled")).not.toBe(
    "true",
  )
})
