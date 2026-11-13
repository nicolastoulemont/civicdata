import { IndicatorId, Politics, ResolvedView, View, Year } from "@repo/domain"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DateTime, Match, Schema } from "effect"
import { http, HttpResponse } from "msw/http"
import { expect, it } from "vitest"

import { network } from "../../test/network.ts"
import { Route as ExploreRoute } from "./explore"

const unemployment = IndicatorId.make("SL.UEM.TOTL.ZS")

// The same unemployment rate for Spain in every year, on a trend or a ranking.
const resolve = http.post("/api/views/resolve", async ({ request }) => {
  const view = Match.value(Schema.decodeUnknownSync(View)(await request.json())).pipe(
    Match.tag("Trend", "Ranking", (shown) => shown),
    Match.orElseAbsurd,
  )

  return HttpResponse.json(
    Schema.encodeSync(ResolvedView)({
      view,
      title: "Unemployment, total (% of total labor force)",
      indicator: { id: unemployment, name: "Unemployment, total", definition: "" },
      observations: [2015, 2016, 2017, 2018, 2019, 2020].map((year) => ({
        country: "ESP",
        year: Year.make(year),
        value: 10,
      })),
      missing: [],
      dimensions: [],
      disagreements: [],
      direction: "Lower",
      sources: [
        {
          indicator: unemployment,
          name: "Unemployment, total",
          source: "World Bank",
          dataset: "World Development Indicators",
          url: `https://api.worldbank.org/v2/indicator/${unemployment}`,
          retrievedAt: DateTime.makeUnsafe("2026-11-08T00:00:00Z"),
        },
      ],
    }),
  )
})

const politics = http.get("/api/politics", () =>
  HttpResponse.json(
    Schema.encodeSync(Politics)({ governments: [], elections: [], events: [], reforms: [] }),
  ),
)

// The /explore page in a router whose address starts at `url`. The route's
// loader only names the page for link previews, and runs server code.
const visit = (url: string) => {
  const Page = ExploreRoute.options.component

  if (Page === undefined) throw new Error("/explore must render its page")

  const queryClient = new QueryClient()
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet })

  const explore = createRoute({
    path: "/explore",
    getParentRoute: () => root,
    validateSearch: ExploreRoute.options.validateSearch,
    component: Page,
  })

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider
        router={createRouter({
          routeTree: root.addChildren([explore]),
          history: createMemoryHistory({ initialEntries: [url] }),
          context: { queryClient },
        })}
      />
    </QueryClientProvider>,
  )
}

it("keeps a trend's governments on after a switch to a ranking and back", async () => {
  network.use(resolve, politics)
  const user = userEvent.setup()

  visit(`/explore?chart=trend&indicator=${unemployment}&countries=ESP&from=2015&to=2020`)

  await user.click(await screen.findByRole("button", { name: "Governments" }))
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Governments" }).getAttribute("aria-pressed")).toBe(
      "true",
    ),
  )
  await user.click(screen.getByRole("button", { name: "Bar chart ranking one year" }))
  await waitFor(() => expect(screen.queryByRole("button", { name: "Governments" })).toBeNull())
  await user.click(screen.getByRole("button", { name: "Line chart over years" }))

  expect(
    (await screen.findByRole("button", { name: "Governments" })).getAttribute("aria-pressed"),
  ).toBe("true")
})
