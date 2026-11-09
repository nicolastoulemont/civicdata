import { Answered, ConversationId, IndicatorId, Trend, Turns, View, Year } from "@civicdata/domain"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Schema } from "effect"
import { http, HttpResponse } from "msw/http"
import { afterEach, expect, it, onTestFinished } from "vitest"

import { preload } from "@/conversation/preload"

import { network } from "../../../test/network.ts"
import { Route as ChatRoute } from "../_chat"
import { Route as ConversationRoute } from "./c.$id"

const id = ConversationId.make("0b5d7c1e-8f4a-4c2b-9d3e-1a2b3c4d5e6f")

const brazil = Trend.make({
  indicator: IndicatorId.make("SP.DYN.LE00.IN"),
  countries: ["BRA"],
  from: Year.make(2000),
  to: Year.make(2001),
})

const encodeTurns = Schema.encodeSync(Schema.toCodecJson(Turns))
const decodeView = Schema.decodeUnknownSync(View)

afterEach(() => localStorage.clear())

it("starts loading a conversation's charts when its sidebar row is hovered", async () => {
  localStorage.setItem(
    "civicdata:conversations",
    JSON.stringify([
      {
        id,
        title: "How has life expectancy changed in Brazil?",
        askedAt: new Date().toISOString(),
      },
    ]),
  )

  const resolved: Array<unknown> = []
  const { promise: loading, resolve: end } = Promise.withResolvers<Response>()

  onTestFinished(() => end(new HttpResponse(null, { status: 503 })))

  network.use(
    http.get(`/api/conversations/${id}`, () =>
      HttpResponse.json(
        encodeTurns({
          answered: [
            {
              question: "How has life expectancy changed in Brazil?",
              answer: Answered.make({ charts: [{ view: brazil }] }),
            },
          ],
        }),
      ),
    ),
    // Records the chart asked for, and leaves it loading until the test ends.
    http.post("/api/views/resolve", async ({ request }) => {
      resolved.push(await request.json())

      return loading
    }),
  )

  const Chat = ChatRoute.options.component
  const Conversation = ConversationRoute.options.component

  if (Chat === undefined || Conversation === undefined) {
    throw new Error("Chat routes must render their pages")
  }

  const queryClient = new QueryClient()
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet })
  const chat = createRoute({ id: "_chat", getParentRoute: () => root, component: Chat })

  const home = createRoute({
    path: "/",
    getParentRoute: () => chat,
    component: () => <main>Home</main>,
  })

  const conversation = createRoute({
    path: "/c/$id",
    getParentRoute: () => chat,
    beforeLoad: ({ params }) => ({ id: Schema.decodeSync(ConversationId)(params.id) }),
    // The conversation route's loader.
    loader: ({ context }) => preload({ queryClient: context.queryClient, id: context.id }),
    component: Conversation,
  })

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider
        router={createRouter({
          routeTree: root.addChildren([chat.addChildren([home, conversation])]),
          history: createMemoryHistory({ initialEntries: ["/"] }),
          context: { queryClient },
          defaultPreload: "intent",
        })}
      />
    </QueryClientProvider>,
  )

  const sidebar = within(await screen.findByRole("navigation", { name: "Conversations" }))

  await userEvent
    .setup()
    .hover(sidebar.getByRole("link", { name: /How has life expectancy changed in Brazil/ }))

  await waitFor(() => expect(resolved.map((body) => decodeView(body))).toEqual([brazil]))
  expect(screen.getByText("Home")).toBeDefined()
})
