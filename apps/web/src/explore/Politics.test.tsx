import {
  type Country,
  Day,
  type Election,
  End,
  type Government,
  IndicatorId,
  Politics,
  PoliticsUnavailable,
  ResolvedView,
  Trend,
  View,
  Year,
} from "@civicdata/domain"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DateTime, Match, Schema } from "effect"
import { http, HttpResponse } from "msw/http"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { network } from "../../test/network.ts"
import { Explore } from "./Explore.tsx"
import type { Overlay } from "./politics.ts"

const unemployment = IndicatorId.make("SL.UEM.TOTL.ZS")

// A government as PPEG records it, valid by default; a test names what it
// asserts on.
const government = (fields: Partial<Government> = {}): Government => ({
  country: "ESP",
  head: "Mariano Rajoy",
  parties: [{ name: "People's Party", abbreviation: "PP" }],
  start: Day.make("2011-12-21"),
  end: End.cases.Open.make({}),
  citation: {
    publisher: "PPEG",
    url: "https://ppeg.wzb.eu/www/ppeg_gov_2025v1.zip",
    retrievedAt: DateTime.makeUnsafe("2026-11-09T04:00:00Z"),
  },
  ...fields,
})

const next = (day: string) => End.cases.Next.make({ day: Day.make(day) })

// Who governed Spain and Portugal around the 2010s, as the API answers.
const recorded: ReadonlyArray<Government> = [
  government({
    head: "José Luís Rodríguez Zapatero",
    parties: [{ name: "Spanish Socialist Workers' Party", abbreviation: "PSOE" }],
    start: Day.make("2008-04-11"),
    end: next("2011-12-21"),
  }),
  government({ start: Day.make("2011-12-21"), end: next("2016-10-31") }),
  government({ start: Day.make("2016-10-31"), end: next("2018-06-07") }),
  government({
    head: "Pedro Sánchez",
    parties: [{ name: "Spanish Socialist Workers' Party", abbreviation: "PSOE" }],
    start: Day.make("2018-06-07"),
    end: End.cases.Cutoff.make({ day: Day.make("2025-10-31") }),
  }),
  government({
    country: "PRT",
    head: "Pedro Passos Coelho",
    parties: [
      { name: "Social Democratic Party", abbreviation: "PSD" },
      { name: "CDS - People's Party", abbreviation: "CDS-PP" },
    ],
    start: Day.make("2011-06-21"),
    end: next("2015-11-26"),
  }),
]

// An election as PPEG records it, valid by default.
const election = (fields: Partial<Election> = {}): Election => ({
  country: "ESP",
  ballot: "parliament",
  date: Day.make("2011-11-20"),
  lastRound: null,
  citation: {
    publisher: "PPEG",
    url: "https://ppeg.wzb.eu/www/ppeg_parl_2025v1.zip",
    retrievedAt: DateTime.makeUnsafe("2026-11-09T04:00:00Z"),
  },
  ...fields,
})

const elections: ReadonlyArray<Election> = [
  election(),
  election({ date: Day.make("2015-12-20") }),
  election({
    country: "PRT",
    ballot: "president",
    date: Day.make("2011-01-23"),
  }),
  election({ country: "PRT", date: Day.make("2011-06-05") }),
]

// The API's records: the governments and elections of the countries asked
// for. The fake answers every year.
const politics = http.get("/api/politics", ({ request }) => {
  const query = new URL(request.url).searchParams
  const countries = (query.get("countries") ?? "").split(",")

  return HttpResponse.json(
    Schema.encodeSync(Politics)({
      governments: recorded.filter((each) => countries.includes(each.country)),
      elections: elections.filter((each) => countries.includes(each.country)),
    }),
  )
})

// The same unemployment rate for every country and year asked for.
const resolve = http.post("/api/views/resolve", async ({ request }) => {
  const view = Schema.decodeUnknownSync(View)(await request.json())

  const trend = Match.value(view).pipe(
    Match.tag("Trend", (shown) => shown),
    Match.orElseAbsurd,
  )

  const observations = trend.countries.flatMap((country) =>
    Array.from({ length: trend.to - trend.from + 1 }, (_, offset) => ({
      country,
      year: Year.make(trend.from + offset),
      value: 10 + offset,
    })),
  )

  return HttpResponse.json(
    Schema.encodeSync(ResolvedView)({
      view: trend,
      title: "Unemployment, total (% of total labor force)",
      indicator: { id: unemployment, name: "Unemployment, total", definition: "" },
      observations,
      missing: [],
      dimensions: [],
      disagreements: [],
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

interface PageProps {
  initial: ReadonlyArray<Overlay>
  trend: Trend
}

// Stands in for the route, which keeps the View and the overlays in the URL.
const Page = ({ initial, trend }: PageProps) => {
  const [view, setView] = useState<View>(trend)
  const [overlays, setOverlays] = useState(initial)

  return (
    <Explore
      view={view}
      onChange={setView}
      overlays={overlays}
      onOverlays={setOverlays}
      heading="h1"
    />
  )
}

const show = (
  countries: readonly [Country, ...Array<Country>],
  initial: ReadonlyArray<Overlay> = [],
) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Page
        initial={initial}
        trend={Trend.make({
          indicator: unemployment,
          countries,
          from: Year.make(2010),
          to: Year.make(2020),
        })}
      />
    </QueryClientProvider>,
  )

// Recharts draws nothing in a box without a size.
let bounds: { mockRestore: () => void } | undefined

beforeEach(() => {
  bounds = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(0, 0, 800, 320))
})

afterEach(() => bounds?.mockRestore())

// Moves the chart's tooltip to its second year, 2011: clicking the chart
// shows its first year, and the arrow key moves on one.
const hover2011 = async (user: ReturnType<typeof userEvent.setup>, figure: HTMLElement) => {
  await within(figure).findByText("Spain")
  await user.click(within(figure).getByRole("application"))
  await user.keyboard("{ArrowRight}")
}

describe("Elections and governments on a trend", () => {
  it("shades a one-country trend in bands named by head of government", async () => {
    network.use(resolve, politics)
    const user = userEvent.setup()

    show(["ESP"])

    const governments = await screen.findByRole("button", { name: "Governments" })

    expect(governments.getAttribute("aria-pressed")).toBe("false")

    await user.click(governments)

    const figure = within(await screen.findByRole("figure"))

    expect(await figure.findByText("Mariano Rajoy")).toBeDefined()
    expect(figure.getByText("Pedro Sánchez")).toBeDefined()
    // The source line credits the archives as they ask to be cited.
    expect(
      screen.getByRole("link", { name: "PPEG (Krause, Döring, Stoppe, WZB Berlin, 2025)" }),
    ).toBeDefined()
  })

  it("names each country's government in the tooltip of a trend of two", async () => {
    network.use(resolve, politics)
    const user = userEvent.setup()

    show(["ESP", "PRT"], ["governments"])

    const figure = await screen.findByRole("figure")

    await hover2011(user, figure)

    expect(
      await within(figure).findByText("Spain: Mariano Rajoy · PP · 2011 to 2018"),
    ).toBeDefined()
    expect(
      within(figure).getByText("Portugal: Pedro Passos Coelho · PSD, CDS-PP · 2011 to 2015"),
    ).toBeDefined()
    // Bands of two countries would overlap.
    expect(within(figure).queryByText("Mariano Rajoy")).toBeNull()
  })

  it("names each country's elections of the hovered year, in the tooltip", async () => {
    network.use(resolve, politics)
    const user = userEvent.setup()

    show(["ESP", "PRT"])

    await user.click(await screen.findByRole("button", { name: "Elections" }))

    const figure = await screen.findByRole("figure")

    await hover2011(user, figure)

    expect(
      await within(figure).findByText("Spain: General election · 20 November 2011"),
    ).toBeDefined()
    expect(
      within(figure).getByText("Portugal: Presidential election · 23 January 2011"),
    ).toBeDefined()
    expect(within(figure).getByText("Portugal: General election · 5 June 2011")).toBeDefined()
    // Governments stay off.
    expect(within(figure).queryByText(/Mariano Rajoy/)).toBeNull()
  })

  it("says so when a country has no election or government records", async () => {
    network.use(resolve, politics)

    show(["ESP", "BRA"], ["elections", "governments"])

    expect(await screen.findByText("No election or government records for Brazil")).toBeDefined()
  })

  it("says the records are unavailable when they cannot be read", async () => {
    network.use(
      resolve,
      http.get("/api/politics", () =>
        HttpResponse.json(Schema.encodeSync(PoliticsUnavailable)(new PoliticsUnavailable()), {
          status: 503,
        }),
      ),
    )

    show(["ESP"], ["governments"])

    expect(await screen.findByText("Election and government records are unavailable")).toBeDefined()
  })

  it("copies a link that opens with the governments shown", async () => {
    network.use(resolve, politics)
    const user = userEvent.setup()

    show(["ESP"])

    await user.click(await screen.findByRole("button", { name: "Governments" }))
    await user.click(screen.getByRole("button", { name: "Copy link" }))
    await screen.findByRole("button", { name: "Link copied" })

    expect(new URL(await navigator.clipboard.readText()).searchParams.get("overlays")).toBe(
      "governments",
    )
  })
})
