import {
  CatalogUnavailable,
  IndicatorId,
  type ResolvedView,
  ResolvedView as ResolvedViewSchema,
  SourceUnavailable,
  transformOf,
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
import { describe, expect, it } from "vitest"

import { network } from "../../test/network.ts"
import { Explore } from "./Explore.tsx"

const population = IndicatorId.make("SP.POP.TOTL")

const catalog = [
  { indicator: population, name: "Population, total", definition: "Midyear estimates." },
  {
    indicator: IndicatorId.make("NY.GDP.PCAP.CD"),
    name: "GDP per capita (current US$)",
    definition: "Gross domestic product divided by midyear population.",
  },
  {
    indicator: IndicatorId.make("SP.DYN.LE00.IN"),
    name: "Life expectancy at birth, total (years)",
    definition: "Years a newborn would live.",
  },
  {
    indicator: IndicatorId.make("SL.UEM.TOTL.ZS"),
    name: "Unemployment, total (% of total labor force)",
    definition: "Share of the labor force without work.",
  },
]

// The server's plain-language titles. An indicator without one is titled
// with its official name.
const titles = new Map([[population, "Total population"]])

const reported: ResolvedView["observations"] = [
  { country: "FRA", year: Year.make(2019), value: 67_388_001 },
  { country: "FRA", year: Year.make(2020), value: 67_571_107 },
  { country: "DEU", year: Year.make(2019), value: 83_092_962 },
  { country: "DEU", year: Year.make(2020), value: 83_160_871 },
  { country: "ITA", year: Year.make(2019), value: 59_729_081 },
  { country: "ITA", year: Year.make(2020), value: 59_438_851 },
]

const named = (indicator: IndicatorId) => ({
  id: indicator,
  name: catalog.find((entry) => entry.indicator === indicator)?.name ?? indicator,
  definition: "",
})

const titled = (indicator: IndicatorId) => titles.get(indicator) ?? named(indicator).name

const source = (indicator: IndicatorId) => ({
  indicator,
  source: "World Bank" as const,
  dataset: "World Development Indicators",
  url: `https://api.worldbank.org/v2/indicator/${indicator}`,
  retrievedAt: DateTime.makeUnsafe("2026-11-08T00:00:00Z"),
})

// Answers like the API: the requested countries and years only, listing a
// requested country with no values as missing. The fake publishes the same
// values for every indicator.
const resolvedFor = (view: View): ResolvedView => {
  const shown = Match.valueTags(view, {
    Trend:
      ({ from, to }) =>
      (year: number) =>
        year >= from && year <= to,
    Ranking: (ranking) => (year: number) => year === ranking.year,
    Change:
      ({ from, to }) =>
      (year: number) =>
        year === from || year === to,
    Relation: (relation) => (year: number) => year === relation.year,
  })

  // Per person, the fake divides by a round million so the change is visible.
  const observations = reported
    .filter(({ country, year }) => view.countries.includes(country) && shown(year))
    .map(({ country, year, value }) => ({
      country,
      year,
      value: transformOf(view) === "PerPerson" ? value / 1_000_000 : value,
    }))

  const fields = {
    title: titled(view.indicator),
    indicator: named(view.indicator),
    observations,
    missing: view.countries.filter(
      (country) => !observations.some((observation) => observation.country === country),
    ),
  }

  return Match.value(view).pipe(
    Match.tag("Relation", (relation) => ({
      view: relation,
      ...fields,
      against: {
        title: titled(relation.against),
        indicator: named(relation.against),
        observations,
      },
      sources: [source(relation.indicator), source(relation.against)] as const,
    })),
    Match.orElse((single) => ({
      view: single,
      ...fields,
      sources: [source(single.indicator)] as const,
    })),
  )
}

const worldBank = http.post("/api/views/resolve", async ({ request }) => {
  const view = Schema.decodeUnknownSync(View)(await request.json())

  return HttpResponse.json(Schema.encodeSync(ResolvedViewSchema)(resolvedFor(view)))
})

const search = http.get("/api/catalog/search", ({ request }) => {
  const text = (new URL(request.url).searchParams.get("q") ?? "").toLowerCase()

  return HttpResponse.json(catalog.filter((entry) => entry.name.toLowerCase().includes(text)))
})

// Stands in for the route, which keeps the View in the URL.
const Page = ({ initial }: { initial: View }) => {
  const [view, setView] = useState(initial)

  return <Explore view={view} onChange={setView} />
}

const show = (view: View) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Page initial={view} />
    </QueryClientProvider>,
  )

const trend = Trend.make({
  indicator: population,
  countries: ["FRA", "DEU"],
  from: Year.make(2019),
  to: Year.make(2020),
})

describe("Explore", () => {
  it("titles the chart in plain words and keeps the official name", async () => {
    network.use(worldBank)
    const user = userEvent.setup()

    show(trend)

    expect(await screen.findByRole("heading", { name: "Total population" })).toBeDefined()
    await user.click(screen.getByRole("button", { name: "About this data" }))
    expect(await screen.findByText("Population, total")).toBeDefined()
  })

  it("adds a country and shows its data", async () => {
    network.use(worldBank)
    const user = userEvent.setup()

    show(trend)

    expect(await screen.findByRole("heading", { name: "Total population" })).toBeDefined()
    await user.click(screen.getByRole("button", { name: "Data" }))
    expect(
      within(await screen.findByRole("table")).queryByRole("cell", { name: "Italy" }),
    ).toBeNull()

    await user.type(screen.getByRole("combobox", { name: "Countries" }), "Ital")
    await user.click(await screen.findByRole("option", { name: "Italy" }))

    const table = within(await screen.findByRole("table"))

    expect(await table.findAllByRole("cell", { name: "Italy" })).toHaveLength(2)
    expect(table.getByRole("cell", { name: "59,438,851" })).toBeDefined()
  })

  it("copies a link to the chart on screen", async () => {
    const link =
      "http://localhost:3000/explore?chart=trend&indicator=SP.POP.TOTL&countries=FRA,DEU&from=2019&to=2020"

    const user = userEvent.setup()

    network.use(worldBank)

    window.history.replaceState(null, "", link)
    show(trend)

    await user.click(await screen.findByRole("button", { name: "Copy link" }))

    expect(await screen.findByRole("button", { name: "Link copied" })).toBeDefined()
    expect(await navigator.clipboard.readText()).toBe(link)
  })

  it("explains when the World Bank is unavailable and offers a retry", async () => {
    network.use(
      http.post("/api/views/resolve", () =>
        HttpResponse.json(
          Schema.encodeSync(SourceUnavailable)(new SourceUnavailable({ source: "World Bank" })),
          {
            status: 502,
          },
        ),
      ),
    )

    show(trend)

    expect(await screen.findByText("The World Bank is not responding")).toBeDefined()
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined()
  })

  it("switches the chart to an indicator found by name", async () => {
    network.use(worldBank, search)
    const user = userEvent.setup()

    show(trend)

    const indicator = await screen.findByRole("combobox", { name: "Indicator" })

    // Select the current indicator's name and type over it.
    await user.tripleClick(indicator)
    await user.keyboard("life")
    await user.click(
      await screen.findByRole("option", { name: "Life expectancy at birth, total (years)" }),
    )

    expect(
      await screen.findByRole("heading", { name: "Life expectancy at birth, total (years)" }),
    ).toBeDefined()
  })

  it("explains when indicator search is unavailable", async () => {
    network.use(
      worldBank,
      http.get("/api/catalog/search", () =>
        HttpResponse.json(Schema.encodeSync(CatalogUnavailable)(new CatalogUnavailable()), {
          status: 503,
        }),
      ),
    )
    const user = userEvent.setup()

    show(trend)

    const indicator = await screen.findByRole("combobox", { name: "Indicator" })

    // Select the current indicator's name and type over it.
    await user.tripleClick(indicator)
    await user.keyboard("life")

    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Indicator search needs D1: run `pnpm dev`, not `pnpm dev:web`.",
    )
  })

  it("switches a trend to a ranking of its last year", async () => {
    network.use(worldBank)
    const user = userEvent.setup()

    show(trend)

    await screen.findByRole("heading", { name: "Total population" })
    await user.click(screen.getByRole("button", { name: "Bar chart ranking one year" }))

    expect(await screen.findByText("Bar chart ranking countries by Total population")).toBeDefined()
    expect(screen.getByRole("combobox", { name: "Year" }).textContent).toContain("2020")
    expect(screen.queryByRole("combobox", { name: "From" })).toBeNull()
  })

  it("switches a trend to the change between its first and last years", async () => {
    network.use(worldBank)
    const user = userEvent.setup()

    show(trend)

    await screen.findByRole("heading", { name: "Total population" })
    await user.click(screen.getByRole("button", { name: "Change between two years" }))

    expect(
      await screen.findByText("Change in Total population between 2019 and 2020, by country"),
    ).toBeDefined()
    expect(screen.getByText("2019 and 2020")).toBeDefined()
    expect(screen.getByRole("button", { name: "Per person" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Growth" })).toBeNull()
  })

  it("plots the indicator against another, with the data of both", async () => {
    network.use(worldBank)
    const user = userEvent.setup()

    show(trend)

    await screen.findByRole("heading", { name: "Total population" })
    await user.click(
      screen.getByRole("button", { name: "Scatter plot of one indicator against another" }),
    )

    expect(
      await screen.findByRole("heading", {
        name: "Total population against GDP per capita (current US$)",
      }),
    ).toBeDefined()
    expect(screen.getByRole("combobox", { name: "Against" })).toBeDefined()
    expect(screen.queryByRole("group", { name: "Show as" })).toBeNull()

    await user.click(screen.getByRole("button", { name: "Data" }))

    const table = within(await screen.findByRole("table"))

    expect(table.getByRole("columnheader", { name: "Total population" })).toBeDefined()
    expect(table.getByRole("columnheader", { name: "GDP per capita (current US$)" })).toBeDefined()
    expect(table.getAllByRole("row")).toHaveLength(3)
  })

  it("shows a total per person", async () => {
    network.use(worldBank)
    const user = userEvent.setup()

    show(trend)

    await screen.findByRole("heading", { name: "Total population" })
    await user.click(screen.getByRole("button", { name: "Per person" }))
    await user.click(screen.getByRole("button", { name: "Data" }))

    expect(await screen.findByText("2019–2020 · per person")).toBeDefined()
    expect(await screen.findByRole("columnheader", { name: "Value (per person)" })).toBeDefined()
    expect(await screen.findByRole("cell", { name: "67.39" })).toBeDefined()
  })

  it("offers no transform for a percentage", async () => {
    network.use(worldBank)

    show(Trend.make({ ...trend, indicator: IndicatorId.make("SL.UEM.TOTL.ZS") }))

    await screen.findByRole("heading", { name: "Unemployment, total (% of total labor force)" })

    for (const name of ["Per person", "Growth", "Index"]) {
      expect(screen.getByRole("button", { name })).toHaveProperty("disabled", true)
    }
  })
})
