import {
  Answered,
  CatalogUnavailable,
  Dimension,
  DimensionsMissing,
  IndicatorId,
  IndicatorNotes,
  type ResolvedView,
  ResolvedView as ResolvedViewSchema,
  SourceUnavailable,
  TooManyQuestions,
  transformOf,
  Trend,
  View,
  Year,
} from "@civicdata/domain"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DateTime, Match, Schema } from "effect"
import { http, HttpResponse } from "msw/http"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { network } from "../../test/network.ts"
import { Explore } from "./Explore.tsx"
import type { Overlay } from "./governments.ts"

const population = IndicatorId.make("SP.POP.TOTL")

const catalog = [
  { indicator: population, name: "Population, total", definition: "Midyear estimates." },
  {
    indicator: IndicatorId.make("NY.GDP.MKTP.CD"),
    name: "GDP (current US$)",
    definition: "Gross domestic product at purchaser's prices.",
  },
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
  { country: "FRA", year: Year.make(2017), value: 66_918_020 },
  { country: "FRA", year: Year.make(2018), value: 67_158_348 },
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
  name: named(indicator).name,
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
    dimensions: [],
    disagreements: [],
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
      // A ratio cites the series it divides by.
      sources: Match.value(single.transform).pipe(
        Match.when(
          { _tag: "Ratio" },
          ({ per }) => [source(single.indicator), source(per)] as const,
        ),
        Match.orElse(() => [source(single.indicator)] as const),
      ),
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

// The agent's takeaway names the chart it was asked about, so a test can
// tell which chart a takeaway is for.
const explain = http.post("/api/views/explain", async ({ request }) => {
  const view = Schema.decodeUnknownSync(View)(await request.json())

  const chart = Match.valueTags(view, {
    Trend: () => "trend",
    Ranking: () => "ranking",
    Change: () => "change",
    Relation: () => "relation",
  })

  return HttpResponse.json(
    Schema.encodeSync(Answered)(
      Answered.make({ view, takeaway: `France grew, as a ${chart} shows.` }),
    ),
  )
})

// The World Bank's notes on any indicator.
const notes = http.get("/api/indicators/:indicator/notes", ({ params }) =>
  HttpResponse.json(
    Schema.encodeSync(IndicatorNotes)({
      indicator: IndicatorId.make(String(params["indicator"])),
      relevance: "Population counts are the denominator of most indicators.",
      limitations: "Censuses happen about every ten years; years between are estimates.",
      url: `https://api.worldbank.org/v2/sources/2/series/${String(params["indicator"])}/metadata?format=json`,
      retrievedAt: DateTime.makeUnsafe("2026-11-08T00:00:00Z"),
    }),
  ),
)

interface PageProps {
  initial: View
}

// Stands in for the route, which keeps the View in the URL.
const Page = ({ initial }: PageProps) => {
  const [view, setView] = useState(initial)
  const [overlays, setOverlays] = useState<ReadonlyArray<Overlay>>([])

  return (
    <Explore
      view={view}
      onChange={setView}
      overlays={overlays}
      onOverlays={setOverlays}
      heading="h1"
      changing
    />
  )
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
  it("names all seven countries in the legend and table when the palette overflows", async () => {
    const countries = ["FRA", "DEU", "ITA", "ESP", "GBR", "USA", "JPN"] as const

    const names = [
      "France",
      "Germany",
      "Italy",
      "Spain",
      "United Kingdom",
      "United States",
      "Japan",
    ]

    const view = Trend.make({ ...trend, countries })

    network.use(
      notes,
      search,
      http.post("/api/views/resolve", () =>
        HttpResponse.json(
          Schema.encodeSync(ResolvedViewSchema)({
            ...resolvedFor(view),
            missing: [],
            observations: countries.flatMap((country, index) => [
              { country, year: Year.make(2019), value: 10 + index },
              { country, year: Year.make(2020), value: 20 + index },
            ]),
          }),
        ),
      ),
    )

    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 800, 320))

    try {
      show(view)

      const figure = within(await screen.findByRole("figure"))

      for (const name of names) {
        expect(figure.getByText(name)).toBeDefined()
      }

      await userEvent.setup().click(screen.getByRole("tab", { name: "Data" }))
      const table = within(await screen.findByRole("table"))

      for (const name of names) expect(table.getAllByRole("cell", { name })).toHaveLength(2)
    } finally {
      bounds.mockRestore()
    }
  })

  it("titles the chart in plain words and keeps the official name", async () => {
    network.use(worldBank, notes, search)
    const user = userEvent.setup()

    show(trend)

    expect(await screen.findByRole("heading", { name: "Total population" })).toBeDefined()
    await user.click(screen.getByRole("tab", { name: "About" }))
    expect(await screen.findByText("Population, total")).toBeDefined()
  })

  it("adds a country and shows its data", async () => {
    network.use(worldBank)
    const user = userEvent.setup()

    show(trend)

    expect(await screen.findByRole("heading", { name: "Total population" })).toBeDefined()
    await user.click(screen.getByRole("tab", { name: "Data" }))
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
    // The router writes commas in the address escaped.
    expect(await navigator.clipboard.readText()).toBe(link.replaceAll(",", "%2C"))
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

  it("credits Eurostat on a Eurostat chart and links to its data browser", async () => {
    const eurostat = IndicatorId.make("ESTAT,TPS00001,1.0")

    network.use(
      http.post("/api/views/resolve", async ({ request }) => {
        const view = Schema.decodeUnknownSync(Trend)(await request.json())
        const resolved = resolvedFor(view)

        return HttpResponse.json(
          Schema.encodeSync(ResolvedViewSchema)({
            view,
            observations: resolved.observations,
            missing: resolved.missing,
            title: "Population on 1 January",
            dimensions: [],
            disagreements: [],
            indicator: { id: eurostat, name: "Population on 1 January", definition: "" },
            sources: [
              {
                indicator: eurostat,
                name: "Population on 1 January",
                source: "Eurostat",
                dataset: "Population on 1 January",
                url: "https://ec.europa.eu/eurostat/api/dissemination/sdmx/3.0/data/dataflow/ESTAT/TPS00001/1.0/*",
                retrievedAt: DateTime.makeUnsafe("2026-11-08T00:00:00Z"),
              },
            ],
          }),
        )
      }),
    )
    const user = userEvent.setup()

    show(Trend.make({ ...trend, indicator: eurostat }))

    expect(
      await screen.findByText(
        "Source: Eurostat, Population on 1 January. Retrieved 8 November 2026.",
      ),
    ).toBeDefined()
    await user.click(screen.getByRole("tab", { name: "About" }))
    expect(
      (await screen.findByRole("link", { name: "ESTAT,TPS00001,1.0" })).getAttribute("href"),
    ).toBe("https://ec.europa.eu/eurostat/databrowser/view/tps00001/default/table")
  })

  it("asks which series of a Eurostat dataset to show, then charts the pick", async () => {
    const unemployment = IndicatorId.make("ESTAT,UNE_RT_A,1.0")

    const sex = Schema.decodeSync(Dimension)({
      id: "sex",
      label: "Sex",
      options: [
        { code: "F", label: "Females" },
        { code: "M", label: "Males" },
        { code: "T", label: "Total" },
      ],
    })

    // Answers like the API: a View that leaves sex open matches several series.
    network.use(
      http.post("/api/views/resolve", async ({ request }) => {
        const view = Schema.decodeUnknownSync(Trend)(await request.json())

        if (view.dimensions?.[sex.id] === undefined)
          return HttpResponse.json(
            Schema.encodeSync(DimensionsMissing)(
              new DimensionsMissing({ indicator: unemployment, dimensions: [sex], open: [sex.id] }),
            ),
            { status: 422 },
          )

        const resolved = resolvedFor(view)

        return HttpResponse.json(
          Schema.encodeSync(ResolvedViewSchema)({
            view,
            title: "Unemployment by sex and age - annual data",
            observations: resolved.observations,
            missing: resolved.missing,
            dimensions: [sex],
            disagreements: [],
            indicator: {
              id: unemployment,
              name: "Unemployment by sex and age - annual data",
              definition: "",
            },
            sources: resolved.sources,
          }),
        )
      }),
    )
    const user = userEvent.setup()

    show(Trend.make({ ...trend, indicator: unemployment }))

    expect(await screen.findByText("Choose which series to show")).toBeDefined()

    await user.click(screen.getByRole("combobox", { name: "Sex" }))
    await user.click(await screen.findByRole("option", { name: "Total" }))

    expect(
      await screen.findByRole("heading", { name: "Unemployment by sex and age - annual data" }),
    ).toBeDefined()
    expect(screen.getByRole("combobox", { name: "Sex" }).textContent).toContain("Total")
    expect(screen.queryByText("Choose which series to show")).toBeNull()
  })

  it("lists the values a source flags under the chart and in the data table", async () => {
    network.use(
      http.post("/api/views/resolve", async ({ request }) => {
        const view = Schema.decodeUnknownSync(Trend)(await request.json())
        const resolved = resolvedFor(view)

        return HttpResponse.json(
          Schema.encodeSync(ResolvedViewSchema)({
            view,
            title: resolved.title,
            indicator: resolved.indicator,
            missing: resolved.missing,
            dimensions: resolved.dimensions,
            disagreements: [],
            sources: resolved.sources,
            // France's values are provisional; Germany's series breaks in 2020.
            observations: resolved.observations.map(({ country, year, value }) =>
              country === "FRA"
                ? { country, year, value, flags: ["Provisional"] as const }
                : year === 2020
                  ? { country, year, value, flags: ["Break"] as const }
                  : { country, year, value },
            ),
          }),
        )
      }),
    )
    const user = userEvent.setup()

    show(trend)

    const flagged = within(await screen.findByRole("list", { name: "Flagged values" }))

    expect(flagged.getByText("Provisional:").parentElement?.textContent).toBe(
      "Provisional: France 2019–2020",
    )
    expect(flagged.getByText("Break in series:").parentElement?.textContent).toBe(
      "Break in series: Germany 2020",
    )

    await user.click(screen.getByRole("tab", { name: "Data" }))

    expect(
      within(await screen.findByRole("table")).getAllByRole("cell", { name: "provisional" }),
    ).toHaveLength(2)
  })

  it("notes where another source's figures differ, citing it", async () => {
    network.use(
      http.post("/api/views/resolve", async ({ request }) => {
        const view = Schema.decodeUnknownSync(Trend)(await request.json())
        const resolved = resolvedFor(view)

        return HttpResponse.json(
          Schema.encodeSync(ResolvedViewSchema)({
            view,
            title: resolved.title,
            indicator: resolved.indicator,
            observations: resolved.observations,
            missing: resolved.missing,
            dimensions: resolved.dimensions,
            sources: resolved.sources,
            disagreements: [
              {
                source: {
                  indicator: IndicatorId.make("ESTAT,TPS00001,1.0"),
                  name: "Population on 1 January",
                  source: "Eurostat",
                  dataset: "Population on 1 January",
                  url: "https://ec.europa.eu/eurostat/api/dissemination/sdmx/3.0/data/dataflow/ESTAT/TPS00001/1.0/*",
                  retrievedAt: DateTime.makeUnsafe("2026-11-08T00:00:00Z"),
                },
                observations: [{ country: "FRA", year: Year.make(2019), value: 67_290_471 }],
              },
            ],
          }),
        )
      }),
    )

    show(trend)

    const note = await screen.findByRole("region", { name: "Other sources" })

    expect(note.textContent).toContain(
      "Eurostat, Population on 1 January: France 2019 67,290,471 (chart: 67,388,001).",
    )
    expect(
      within(note).getByRole("link", { name: "Population on 1 January" }).getAttribute("href"),
    ).toBe("https://ec.europa.eu/eurostat/databrowser/view/tps00001/default/table")
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

  it("draws a trend's last year as a world map with a key", async () => {
    network.use(worldBank)
    const user = userEvent.setup()

    show(trend)

    await screen.findByRole("heading", { name: "Total population" })
    await user.click(screen.getByRole("button", { name: "World map ranking one year" }))

    expect(await screen.findByText("World map ranking countries by Total population")).toBeDefined()
    expect(screen.getByText("No data")).toBeDefined()
    expect(screen.getByRole("combobox", { name: "Year" }).textContent).toContain("2020")
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
    expect(screen.getByText("France and Germany · 2019 and 2020")).toBeDefined()
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

    await user.click(screen.getByRole("tab", { name: "Data" }))

    const table = within(await screen.findByRole("table"))

    expect(table.getByRole("columnheader", { name: "Total population" })).toBeDefined()
    expect(table.getByRole("columnheader", { name: "GDP per capita (current US$)" })).toBeDefined()
    expect(table.getAllByRole("row")).toHaveLength(3)
  })

  it("picks a trend's years on a window over its whole history", async () => {
    network.use(worldBank)
    const user = userEvent.setup()

    show(trend)

    await screen.findByRole("heading", { name: "Total population" })
    // The history reaches back to 2017, before the trend's first year.
    const first = await screen.findByRole("slider", { name: "First year" })

    act(() => first.focus())
    await user.keyboard("{ArrowLeft}")

    expect(await screen.findByText("France and Germany · 2018–2020")).toBeDefined()
    expect(screen.getByRole("combobox", { name: "From" }).textContent).toContain("2018")
  })

  it("shows a total per person", async () => {
    network.use(worldBank)
    const user = userEvent.setup()

    show(trend)

    await screen.findByRole("heading", { name: "Total population" })
    await user.click(screen.getByRole("button", { name: "Per person" }))
    await user.click(screen.getByRole("tab", { name: "Data" }))

    expect(await screen.findByText("France and Germany · 2019–2020 · per person")).toBeDefined()
    expect(await screen.findByRole("columnheader", { name: "Value (per person)" })).toBeDefined()
    expect(await screen.findByRole("cell", { name: "67.39" })).toBeDefined()
  })

  it("shows a total as a ratio of another indicator, citing both", async () => {
    network.use(worldBank)
    const user = userEvent.setup()

    show(trend)

    await screen.findByRole("heading", { name: "Total population" })
    await user.click(screen.getByRole("button", { name: "Ratio" }))

    expect(
      await screen.findByText("France and Germany · 2019–2020 · per GDP (current US$)"),
    ).toBeDefined()
    expect(screen.getByRole("combobox", { name: "Per" })).toBeDefined()

    await user.click(screen.getByRole("tab", { name: "Data" }))

    expect(await screen.findByRole("link", { name: "NY.GDP.MKTP.CD request" })).toBeDefined()
    expect(screen.getByRole("link", { name: "SP.POP.TOTL request" })).toBeDefined()
  })

  it("offers no transform for a percentage", async () => {
    network.use(worldBank)

    show(Trend.make({ ...trend, indicator: IndicatorId.make("SL.UEM.TOTL.ZS") }))

    await screen.findByRole("heading", { name: "Unemployment, total (% of total labor force)" })

    for (const name of ["Per person", "Growth", "Index", "Ratio"]) {
      expect(screen.getByRole("button", { name })).toHaveProperty("disabled", true)
    }
  })

  it("explains the chart on screen, and greys the explanation out after an edit", async () => {
    network.use(worldBank, explain)
    const user = userEvent.setup()

    show(trend)

    await screen.findByRole("heading", { name: "Total population" })
    await user.click(screen.getByRole("button", { name: "Explain this chart" }))

    expect(await screen.findByText("France grew, as a trend shows.")).toBeDefined()
    expect(screen.queryByRole("button", { name: "Explain this chart" })).toBeNull()

    await user.click(screen.getByRole("button", { name: "Bar chart ranking one year" }))

    expect(await screen.findByText("This describes the chart before your changes.")).toBeDefined()
    expect(screen.getByText("France grew, as a trend shows.").className).toContain(
      "text-muted-foreground",
    )

    await user.click(screen.getByRole("button", { name: "Explain this chart" }))

    expect(await screen.findByText("France grew, as a ranking shows.")).toBeDefined()
    expect(screen.queryByText("This describes the chart before your changes.")).toBeNull()
  })

  it("explains when the visitor asked for too many explanations", async () => {
    network.use(
      worldBank,
      http.post("/api/views/explain", () =>
        HttpResponse.json(Schema.encodeSync(TooManyQuestions)(new TooManyQuestions()), {
          status: 429,
        }),
      ),
    )
    const user = userEvent.setup()

    show(trend)

    await screen.findByRole("heading", { name: "Total population" })
    await user.click(screen.getByRole("button", { name: "Explain this chart" }))

    expect(await screen.findByText("Too many questions in a minute")).toBeDefined()
  })

  it("says why the indicator matters, its limitations, and switches to a related one", async () => {
    const female = IndicatorId.make("SP.POP.TOTL.FE.IN")

    network.use(
      worldBank,
      notes,
      // Codes starting with the current one's stem, as the catalog ranks them.
      http.get("/api/catalog/search", () =>
        HttpResponse.json([
          catalog[0],
          { indicator: female, name: "Population, female", definition: "" },
        ]),
      ),
    )
    const user = userEvent.setup()

    show(trend)

    await screen.findByRole("heading", { name: "Total population" })
    await user.click(screen.getByRole("tab", { name: "About" }))

    expect(
      within(await screen.findByRole("region", { name: "Why it matters" })).getByText(
        "Population counts are the denominator of most indicators.",
      ),
    ).toBeDefined()
    expect(
      within(screen.getByRole("region", { name: "Limitations" })).getByText(
        "Censuses happen about every ten years; years between are estimates.",
      ),
    ).toBeDefined()

    const related = within(await screen.findByRole("region", { name: "Related indicators" }))

    expect(related.queryByRole("button", { name: "Population, total" })).toBeNull()
    await user.click(related.getByRole("button", { name: "Population, female" }))

    expect(await screen.findByRole("heading", { name: female })).toBeDefined()
  })
})
