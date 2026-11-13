import {
  Explanation,
  CatalogUnavailable,
  Change,
  countries as economies,
  Dimension,
  Dimensions,
  DimensionsMissing,
  type Direction,
  directionAfter,
  IndicatorId,
  Input,
  IndicatorNotes,
  type Overlay,
  type ResolvedView,
  Ranking,
  Relation,
  ResolvedView as ResolvedViewSchema,
  sourceOf,
  SourceUnavailable,
  TooManyQuestions,
  transformOf,
  Trend,
  View,
  Year,
} from "@repo/domain"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DateTime, Match, Schema } from "effect"
import type { i18n } from "i18next"
import { http, HttpResponse } from "msw/http"
import { useState } from "react"
import { I18nextProvider } from "react-i18next"
import { describe, expect, it, vi } from "vitest"

import { network } from "../../test/network.ts"
import { createI18n } from "../locale.tsx"
import { Explore } from "./Explore.tsx"
import { fromUrl } from "./search.ts"

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

const unemployment = IndicatorId.make("SL.UEM.TOTL.ZS")

// The server's hand-checked directions; any other indicator is neutral.
const directions = new Map<IndicatorId, Direction>([
  [unemployment, "Lower"],
  [IndicatorId.make("SP.DYN.LE00.IN"), "Higher"],
])

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

// A ratio cites the series it divides by.
const sourcesOf = (single: Exclude<View, { readonly _tag: "Relation" }>) =>
  Match.value(single.transform).pipe(
    Match.when({ _tag: "Ratio" }, ({ per }) => [source(single.indicator), source(per)] as const),
    Match.orElse(() => [source(single.indicator)] as const),
  )

// Answers like the API: the requested countries and years only, listing a
// requested country with no values as missing. The fake publishes the same
// values for every indicator.
const resolvedFor = (view: View): ResolvedView => {
  const shown = Match.valueTags(view, {
    Trend:
      ({ from, to }) =>
      (year: number) =>
        year >= from && year <= to,
    Ranking:
      ({ year, span }) =>
      (each: number) =>
        span === undefined ? each === year : each >= span.from && each <= span.to,
    Change:
      ({ from, to }) =>
      (year: number) =>
        year === from || year === to,
    Relation:
      ({ year, span }) =>
      (each: number) =>
        span === undefined ? each === year : each >= span.from && each <= span.to,
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
    direction: directionAfter(directions.get(view.indicator) ?? "Neutral", transformOf(view)),
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
    // A change keeps the breaks in series between its years; the fake has none.
    Match.tag("Change", (change) => ({
      view: change,
      ...fields,
      sources: sourcesOf(change),
      breaks: [],
    })),
    Match.orElse((single) => ({ view: single, ...fields, sources: sourcesOf(single) })),
  )
}

const worldBank = http.post("/api/views/resolve", async ({ request }) => {
  const view = Schema.decodeUnknownSync(View)(await request.json())

  return HttpResponse.json(Schema.encodeSync(ResolvedViewSchema)(resolvedFor(view)))
})

// The catalog entries whose name contains the searched text.
const answer = (request: Request) => {
  const text = (new URL(request.url).searchParams.get("q") ?? "").toLowerCase()

  return HttpResponse.json(catalog.filter((entry) => entry.name.toLowerCase().includes(text)))
}

const search = http.get("/api/catalog/search", ({ request }) => answer(request))

// A search that answers only once let go, so a test sees what shows while
// results load. `release` answers every search sent so far.
const gatedSearch = () => {
  const waiting: Array<() => void> = []

  return {
    handler: http.get("/api/catalog/search", async ({ request }) => {
      await new Promise<void>((resolve) => waiting.push(resolve))

      return answer(request)
    }),
    release: () => {
      for (const resolve of waiting.splice(0)) resolve()
    },
  }
}

// The agent's explanation names the chart it was asked about, so a test can
// tell which chart an explanation is for.
const explain = http.post("/api/views/explain", async ({ request }) => {
  const view = Schema.decodeUnknownSync(View)(await request.json())

  const chart = Match.valueTags(view, {
    Trend: () => "trend",
    Ranking: () => "ranking",
    Change: () => "change",
    Relation: () => "relation",
  })

  return HttpResponse.json(
    Schema.encodeSync(Explanation)({ view, text: `France grew, as a ${chart} shows.` }),
  )
})

// What each source writes about any of its indicators: the World Bank's
// notes, or Eurostat's reference metadata.
const notes = http.get("/api/indicators/:indicator/notes", ({ params }) => {
  const indicator = IndicatorId.make(String(params["indicator"]))
  const retrievedAt = DateTime.makeUnsafe("2026-11-08T00:00:00Z")

  return HttpResponse.json(
    Schema.encodeSync(IndicatorNotes)(
      sourceOf(indicator) === "Eurostat"
        ? IndicatorNotes.cases.Eurostat.make({
            indicator,
            concepts: "Population on 1 January counts usual residents.",
            accuracy: null,
            comparability: {
              countries: null,
              time: "Census years bring breaks in series.\n\nEurostat flags each break.",
            },
            coherence: null,
            url: "https://ec.europa.eu/eurostat/api/dissemination/files?file=metadata/demo_pop_esms.sdmx.zip",
            retrievedAt,
          })
        : IndicatorNotes.cases["World Bank"].make({
            indicator,
            relevance: "Population counts are the denominator of most indicators.",
            limitations: "Censuses happen about every ten years; years between are estimates.",
            methodology: null,
            producer: {
              name: "World Population Prospects, United Nations (UN)",
              url: "https://population.un.org/wpp/",
            },
            url: `https://api.worldbank.org/v2/sources/2/series/${indicator}/metadata?format=json`,
            retrievedAt,
          }),
    ),
  )
})

// Answers like the API, holding back the Views `held` matches until the test
// releases them, so it can look at the card while they load.
const holding = (held: (view: View) => boolean) => {
  const gate = Promise.withResolvers<void>()

  const handler = http.post("/api/views/resolve", async ({ request }) => {
    const view = Schema.decodeUnknownSync(View)(await request.json())

    if (held(view)) await gate.promise

    return HttpResponse.json(Schema.encodeSync(ResolvedViewSchema)(resolvedFor(view)))
  })

  return { handler, release: () => gate.resolve() }
}

// A trend's whole history, which the window under the chart picks its years on.
const isHistory = (view: View) =>
  Match.value(view).pipe(
    Match.tag("Trend", ({ from }) => from === 1960),
    Match.orElse(() => false),
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

const show = (view: View, instance: i18n = createI18n()) =>
  render(
    <I18nextProvider i18n={instance}>
      <QueryClientProvider client={new QueryClient()}>
        <Page initial={view} />
      </QueryClientProvider>
    </I18nextProvider>,
  )

const trend = Trend.make({
  indicator: population,
  countries: ["FRA", "DEU"],
  from: Year.make(2019),
  to: Year.make(2020),
})

// The catalog's country names, in its order.
const catalogNames = economies.map((country) => country.name)

// A trend of the catalog's first `count` countries.
const trendOf = (count: number) => {
  const [first, ...rest] = economies

  return Trend.make({
    ...trend,
    countries: [first.code, ...rest.slice(0, count - 1).map(({ code }) => code)],
  })
}

// The countries the field shows as chips, read from their remove buttons.
const chips = (field: HTMLElement) =>
  within(field)
    .queryAllByRole("button", { name: /^Remove / })
    .map((remove) => remove.getAttribute("aria-label")?.replace(/^Remove /, ""))

// A trend of `countries` whose values rise with their position, drawn in a
// box Recharts can lay out.
const drawTrend = (countries: Trend["countries"]) => {
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

  return show(view)
}

// A box for the chart, and a line's height for its legend, which Recharts
// takes off the plot's.
const layOut = () =>
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("recharts-legend-wrapper")
      ? new DOMRect(0, 0, 800, 24)
      : new DOMRect(0, 0, 800, 320)
  })

// Each line's colour, in the order of the trend's countries.
const strokes = (figure: HTMLElement) =>
  [...figure.querySelectorAll(".recharts-line-curve")].map((line) => line.getAttribute("stroke"))

// One second of a faked clock, rendered.
const second = () =>
  act(() => {
    vi.advanceTimersByTime(1000)
  })

// A country's outline on the map, labelled with its name and value.
const outline = (name: string) => screen.getByLabelText((label) => label.startsWith(`${name}: `))

// A country's shade on the map.
const shadeOf = (name: string) => outline(name).getAttribute("fill")

// The map's key, each shade's values then "No data".
const mapKey = () =>
  [...screen.getByText("No data").parentElement!.querySelectorAll("li")].map(
    (entry) => entry.textContent,
  )

describe("Explore", () => {
  it("names all seven countries in the legend, at their lines' ends and in the table, each in its own colour", async () => {
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

    const bounds = layOut()

    try {
      drawTrend(countries)

      const shown = await screen.findByRole("figure")
      const figure = within(shown)

      await figure.findByRole("button", { name: "Japan" })

      expect(new Set(strokes(shown)).size).toBe(7)

      // Each line is named in the legend and at its end.
      const plot = within(
        await vi.waitUntil(() => shown.querySelector<HTMLElement>(".recharts-surface")),
      )

      for (const name of names) {
        expect(figure.getByRole("button", { name })).toBeDefined()
        expect(plot.getByText(name)).toBeDefined()
      }

      await userEvent.setup().click(screen.getByRole("tab", { name: "Data" }))
      const table = within(await screen.findByRole("table"))

      for (const name of names) expect(table.getAllByRole("cell", { name })).toHaveLength(2)
    } finally {
      bounds.mockRestore()
    }
  })

  it("names a trend of nine countries in its legend only", async () => {
    const bounds = layOut()

    try {
      drawTrend(["FRA", "DEU", "ITA", "ESP", "GBR", "USA", "JPN", "CAN", "MEX"])

      const shown = await screen.findByRole("figure")

      await within(shown).findByRole("button", { name: "Mexico" })

      const plot = await vi.waitUntil(() => shown.querySelector<HTMLElement>(".recharts-surface"))

      expect(within(plot).queryByText("Mexico")).toBeNull()
    } finally {
      bounds.mockRestore()
    }
  })

  it("brings a country forward while its legend entry is pointed at, and keeps it once pressed", async () => {
    const bounds = layOut()

    try {
      const user = userEvent.setup()

      drawTrend(["FRA", "DEU", "ITA"])

      const shown = await screen.findByRole("figure")

      const legend = within(
        await within(shown).findByRole("group", { name: "Highlight a country" }),
      )

      const france = legend.getByRole("button", { name: "France" })

      const opacities = () =>
        [...shown.querySelectorAll(".recharts-line-curve")].map((line) =>
          line.getAttribute("stroke-opacity"),
        )

      await user.hover(france)
      expect(opacities()).toEqual(["1", "0.15", "0.15"])

      await user.unhover(france)
      expect(opacities()).toEqual(["1", "1", "1"])

      await user.click(france)
      await user.unhover(france)
      expect(france.getAttribute("aria-pressed")).toBe("true")
      expect(opacities()).toEqual(["1", "0.15", "0.15"])

      await user.click(france)
      await user.unhover(france)
      expect(france.getAttribute("aria-pressed")).toBe("false")
      expect(opacities()).toEqual(["1", "1", "1"])
    } finally {
      bounds.mockRestore()
    }
  })

  it("draws France in the same colour whatever its place in the trend", async () => {
    const bounds = layOut()

    try {
      const first = drawTrend(["FRA", "DEU"])
      const before = await screen.findByRole("figure")

      await within(before).findByRole("button", { name: "Germany" })
      const [france] = strokes(before)

      first.unmount()
      drawTrend(["DEU", "ITA", "FRA"])

      const after = await screen.findByRole("figure")

      await within(after).findByRole("button", { name: "Italy" })

      expect(france).toMatch(/^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/)
      expect(strokes(after)[2]).toBe(france)
    } finally {
      bounds.mockRestore()
    }
  })

  it("lists a year's values in the tooltip highest first", async () => {
    const bounds = layOut()

    try {
      const user = userEvent.setup()

      drawTrend(["FRA", "DEU", "ITA"])

      const shown = await screen.findByRole("figure")

      await within(shown).findByRole("button", { name: "Italy" })
      await user.click(within(shown).getByRole("application"))
      await user.keyboard("{ArrowRight}")

      const tooltip = await vi.waitUntil(() =>
        shown.querySelector<HTMLElement>(".recharts-tooltip-wrapper"),
      )

      expect(await within(tooltip).findByText("2020")).toBeDefined()
      expect(
        within(tooltip)
          .getAllByText(/^(France|Germany|Italy)$/)
          .map((name) => name.textContent),
      ).toEqual(["Italy", "Germany", "France"])
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

  it("hints at adding a country only while none is chosen", async () => {
    network.use(worldBank)

    show(trend)

    const countries = await screen.findByRole("combobox", { name: "Countries" })

    expect(countries.getAttribute("placeholder")).toBeNull()
  })

  it("shows the first 3 of 27 countries in the field, and all 27 once asked", async () => {
    network.use(worldBank, notes, search)
    const user = userEvent.setup()

    show(trendOf(27))

    const field = await screen.findByRole("toolbar")

    expect(chips(field)).toEqual(catalogNames.slice(0, 3))

    await user.click(within(field).getByRole("button", { name: "Show all 27 countries" }))

    expect(chips(field)).toEqual(catalogNames.slice(0, 27))

    await user.click(within(field).getByRole("button", { name: "Show fewer countries" }))

    expect(chips(field)).toEqual(catalogNames.slice(0, 3))
  })

  it("shows all of 4 countries in the field, with no button", async () => {
    network.use(worldBank, notes, search)

    show(trendOf(4))

    const field = await screen.findByRole("toolbar")

    expect(chips(field)).toEqual(catalogNames.slice(0, 4))
    expect(within(field).queryByRole("button", { name: /^Show / })).toBeNull()
  })

  it("counts a country added while the field is collapsed", async () => {
    network.use(worldBank, notes, search)
    const user = userEvent.setup()

    show(trendOf(27))

    const added = catalogNames[27] ?? ""

    await user.type(await screen.findByRole("combobox", { name: "Countries" }), added)
    await user.click(await screen.findByRole("option", { name: added }))

    const field = screen.getByRole("toolbar")

    expect(
      await within(field).findByRole("button", { name: "Show all 28 countries" }),
    ).toBeDefined()
    expect(chips(field)).toEqual(catalogNames.slice(0, 3))
  })

  it("keeps every country on Backspace while the field is collapsed", async () => {
    network.use(worldBank, notes, search)
    const user = userEvent.setup()

    show(trendOf(27))

    await user.click(await screen.findByRole("combobox", { name: "Countries" }))
    // Escape closes the dropdown, which hides the rest of the page while open.
    await user.keyboard("{Backspace}{Escape}")

    const field = screen.getByRole("toolbar")

    expect(chips(field)).toEqual(catalogNames.slice(0, 3))
    await user.click(within(field).getByRole("button", { name: "Show all 27 countries" }))
    expect(chips(field)).toEqual(catalogNames.slice(0, 27))
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

  const eurostat = IndicatorId.make("ESTAT,TPS00001,1.0")

  // Eurostat's population on 1 January, with the fake's values.
  const eurostatPopulation = http.post("/api/views/resolve", async ({ request }) => {
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
        direction: "Neutral",
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
  })

  it("credits Eurostat on a Eurostat chart and links to its data browser", async () => {
    network.use(eurostatPopulation, notes)
    const user = userEvent.setup()

    show(Trend.make({ ...trend, indicator: eurostat }))

    expect(
      await screen.findByText(
        "Source: Eurostat, Population on 1 January. Retrieved November 8, 2026.",
      ),
    ).toBeDefined()
    await user.click(screen.getByRole("tab", { name: "About" }))
    expect(
      (await screen.findByRole("link", { name: "ESTAT,TPS00001,1.0" })).getAttribute("href"),
    ).toBe("https://ec.europa.eu/eurostat/databrowser/view/tps00001/default/table")
  })

  it("shows Eurostat's notes on how it measures and compares its data", async () => {
    network.use(eurostatPopulation, notes)
    const user = userEvent.setup()

    show(Trend.make({ ...trend, indicator: eurostat }))

    await screen.findByRole("heading", { name: "Population on 1 January" })
    await user.click(screen.getByRole("tab", { name: "About" }))

    expect(
      within(await screen.findByRole("region", { name: "Concepts and definitions" })).getByText(
        "Population on 1 January counts usual residents.",
      ),
    ).toBeDefined()

    const time = within(screen.getByRole("region", { name: "Comparability over time" }))

    expect(time.getByText("Census years bring breaks in series.")).toBeDefined()
    expect(time.getByText("Eurostat flags each break.")).toBeDefined()
    // Eurostat wrote no section on accuracy.
    expect(screen.queryByRole("region", { name: "Accuracy" })).toBeNull()
  })

  it("asks which series of a Eurostat dataset to show, then charts the pick", async () => {
    const eurostatUnemployment = IndicatorId.make("ESTAT,UNE_RT_A,1.0")

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
              new DimensionsMissing({
                indicator: eurostatUnemployment,
                dimensions: [sex],
                open: [sex.id],
              }),
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
            direction: "Lower",
            indicator: {
              id: eurostatUnemployment,
              name: "Unemployment by sex and age - annual data",
              definition: "",
            },
            sources: resolved.sources,
          }),
        )
      }),
    )
    const user = userEvent.setup()

    show(Trend.make({ ...trend, indicator: eurostatUnemployment }))

    expect(await screen.findByText("Choose which series to show")).toBeDefined()

    await user.click(screen.getByRole("combobox", { name: "Sex" }))
    await user.click(await screen.findByRole("option", { name: "Total" }))

    expect(
      await screen.findByRole("heading", { name: "Unemployment by sex and age - annual data" }),
    ).toBeDefined()
    expect(screen.getByRole("combobox", { name: "Sex" }).textContent).toContain("Total")
    expect(screen.queryByText("Choose which series to show")).toBeNull()
  })

  it("takes away a Eurostat dataset's series while the next indicator loads", async () => {
    const eurostatUnemployment = IndicatorId.make("ESTAT,UNE_RT_A,1.0")
    const life = IndicatorId.make("SP.DYN.LE00.IN")
    const gate = Promise.withResolvers<void>()

    const sex = Schema.decodeSync(Dimension)({
      id: "sex",
      label: "Sex",
      options: [
        { code: "F", label: "Females" },
        { code: "T", label: "Total" },
      ],
    })

    network.use(
      search,
      http.post("/api/views/resolve", async ({ request }) => {
        const view = Schema.decodeUnknownSync(View)(await request.json())

        if (view.indicator === life) await gate.promise

        const resolved = resolvedFor(view)

        return HttpResponse.json(
          Schema.encodeSync(ResolvedViewSchema)(
            view.indicator === eurostatUnemployment ? { ...resolved, dimensions: [sex] } : resolved,
          ),
        )
      }),
    )
    const user = userEvent.setup()

    show(
      Trend.make({
        ...trend,
        indicator: eurostatUnemployment,
        dimensions: Schema.decodeSync(Dimensions)({ sex: "T" }),
      }),
    )

    expect(await screen.findByRole("combobox", { name: "Sex" })).toBeDefined()

    await user.tripleClick(screen.getByRole("combobox", { name: "Indicator" }))
    await user.keyboard("life")
    await user.click(
      await screen.findByRole("option", { name: "Life expectancy at birth, total (years)" }),
    )

    // Until its own data names it, the card calls the indicator by its code.
    expect(await screen.findByRole("heading", { name: life })).toBeDefined()
    expect(screen.queryByRole("combobox", { name: "Sex" })).toBeNull()

    gate.resolve()

    expect(
      await screen.findByRole("heading", { name: "Life expectancy at birth, total (years)" }),
    ).toBeDefined()
    expect(screen.queryByRole("combobox", { name: "Sex" })).toBeNull()
  })

  it("shows each unit's full label when units share a long prefix", async () => {
    const growth = IndicatorId.make("ESTAT,TEC00115,1.0")

    const unit = Schema.decodeSync(Dimension)({
      id: "unit",
      label: "Unit of measure",
      options: [
        {
          code: "CLV_PCH_PRE",
          label: "Chain linked volumes, percentage change on previous period",
        },
        {
          code: "CLV_PCH_PRE_HAB",
          label: "Chain linked volumes, percentage change on previous period, per capita",
        },
      ],
    })

    network.use(
      http.post("/api/views/resolve", async ({ request }) => {
        const view = Schema.decodeUnknownSync(Trend)(await request.json())
        const resolved = resolvedFor(view)

        return HttpResponse.json(
          Schema.encodeSync(ResolvedViewSchema)({
            ...resolved,
            view,
            title: "Real GDP growth rate - volume",
            dimensions: [unit],
            indicator: { id: growth, name: "Real GDP growth rate - volume", definition: "" },
          }),
        )
      }),
    )
    const user = userEvent.setup()

    show(
      Trend.make({
        ...trend,
        indicator: growth,
        dimensions: Schema.decodeSync(Dimensions)({ unit: "CLV_PCH_PRE_HAB" }),
      }),
    )

    const select = await screen.findByRole("combobox", { name: "Unit of measure" })

    // The closed select shows what fits, and the whole label on hover.
    expect(select.getAttribute("title")).toBe(
      "Chain linked volumes, percentage change on previous period, per capita",
    )

    await user.click(select)

    expect(
      await screen.findByRole("option", {
        name: "Chain linked volumes, percentage change on previous period",
      }),
    ).toBeDefined()
    expect(
      screen.getByRole("option", {
        name: "Chain linked volumes, percentage change on previous period, per capita",
      }),
    ).toBeDefined()
  })

  it("shows missing ILOSTAT warnings and reference-period notes after resolving a saved chart", async () => {
    const saved = Trend.make({
      indicator: IndicatorId.make("ILOSTAT:SDG_B552_NOC_RT_A"),
      dimensions: Schema.decodeUnknownSync(Dimensions)({ source: "s42413a3135373135" }),
      countries: ["AFG"],
      from: Year.make(2021),
      to: Year.make(2021),
    })

    network.use(
      http.post("/api/views/resolve", async ({ request }) => {
        const view = Schema.decodeUnknownSync(Trend)(await request.json())

        return HttpResponse.json(
          Schema.encodeSync(ResolvedViewSchema)({
            ...resolvedFor(view),
            sources: [
              {
                ...source(view.indicator),
                source: "ILOSTAT",
                dataset: "SDG_B552_NOC_RT_A; International Labour Organization (ILO), ILOSTAT",
                url: "https://rplumber.ilo.org/data/indicator?format=.csv.gz&id=SDG_B552_NOC_RT_A",
              },
            ],
            qualifications: [
              {
                source: "ILOSTAT",
                survey: { code: "BA:15715", label: "LFS - Labour Force Survey" },
                series: {
                  indicator: view.indicator,
                  dimensions: view.dimensions ?? {},
                },
                country: "AFG",
                year: Year.make(2021),
                missing: true,
                exclusion: "ReferencePeriod",
                status: { code: "U", label: "Unreliable" },
                notes: [
                  {
                    category: "Source",
                    code: "S3:8",
                    label: "Data reference period: First quarter",
                  },
                ],
              },
            ],
          }),
        )
      }),
    )
    show(saved)
    const warnings = within(await screen.findByRole("list", { name: "Flagged values" }))
    expect(warnings.getByText(/Unreliable/)).toBeDefined()
    expect(warnings.getByText("Missing value")).toBeDefined()
    expect(warnings.getByText("Excluded reference period")).toBeDefined()
    expect(warnings.getByText(/Data reference period: First quarter/)).toBeDefined()
  })

  it("shows FAO flags and credit without an ILO survey after resolving a saved chart", async () => {
    const saved = Trend.make({
      indicator: IndicatorId.make("FAOSTAT:AE"),
      dimensions: Schema.decodeUnknownSync(Dimensions)({
        measure: "8006",
        cost: "300",
        institution: "200",
      }),
      countries: ["AFG"],
      from: Year.make(2021),
      to: Year.make(2021),
    })

    network.use(
      http.post("/api/views/resolve", async ({ request }) => {
        const view = Schema.decodeUnknownSync(Trend)(await request.json())

        return HttpResponse.json(
          Schema.encodeSync(ResolvedViewSchema)({
            ...resolvedFor(view),
            sources: [
              {
                ...source(view.indicator),
                source: "FAOSTAT",
                dataset: "FAO. 2026. FAOSTAT: ASTI - Expenditures (AE); Licence: CC-BY-4.0",
                url: "https://bulks-faostat.fao.org/production/ASTI_Expenditures_E_All_Data_(Normalized).zip",
              },
            ],
            qualifications: [
              {
                source: "FAOSTAT",
                series: {
                  indicator: view.indicator,
                  dimensions: view.dimensions ?? {},
                },
                country: "AFG",
                year: Year.make(2021),
                missing: true,
                status: { code: "I", label: "Value imputed by a receiving agency" },
                notes: [
                  {
                    category: "Note",
                    code: "Note",
                    label: "Publisher caveat",
                  },
                ],
              },
            ],
          }),
        )
      }),
    )
    show(saved)
    const warnings = within(await screen.findByRole("list", { name: "Flagged values" }))
    expect(warnings.getByText(/I: Value imputed by a receiving agency/)).toBeDefined()
    expect(warnings.getByText("Missing value")).toBeDefined()
    expect(warnings.getByText(/Publisher caveat/)).toBeDefined()
    expect(screen.getAllByText(/FAO. 2026. FAOSTAT/).length).toBeGreaterThan(0)
  })

  it("shows the published estimate, interval and attribution after restoring a V-Dem chart", async () => {
    const saved = Trend.make({
      indicator: IndicatorId.make("V-Dem:v2x_polyarchy"),
      countries: ["FRA"],
      from: Year.make(2025),
      to: Year.make(2025),
    })

    network.use(
      http.post("/api/views/resolve", async ({ request }) => {
        const view = Schema.decodeUnknownSync(Trend)(await request.json())

        return HttpResponse.json(
          Schema.encodeSync(ResolvedViewSchema)({
            ...resolvedFor(view),
            observations: [
              { country: "FRA", year: Year.make(2025), value: 0.865, flags: ["Estimated"] },
            ],
            sources: [
              {
                ...source(view.indicator),
                source: "V-Dem",
                dataset: "Coppedge et al. (2026). V-Dem Country-Year Dataset v16. CC BY-SA 4.0",
                url: "https://doi.org/10.23696/vdemds26",
              },
            ],
            qualifications: [
              {
                source: "V-Dem",
                series: { indicator: view.indicator, dimensions: {} },
                country: "FRA",
                year: Year.make(2025),
                missing: false,
                notes: [],
                version:
                  "V16/f4dd26922e658442524dfd954bf14f7ebe622d5d/39b412d39a061c18f20c98e4ad4d6355b05a0441df31be4ee9aec420dc3d95ea",
                evidence: {
                  commit: "f4dd26922e658442524dfd954bf14f7ebe622d5d",
                  sha256: "39b412d39a061c18f20c98e4ad4d6355b05a0441df31be4ee9aec420dc3d95ea",
                },
                estimate: 0.865,
                interval: {
                  lower: 0.828,
                  upper: 0.914,
                  method: "HPD",
                  level: 0.68,
                  lowerField: "v2x_polyarchy_codelow",
                  upperField: "v2x_polyarchy_codehigh",
                  codebook: "https://v-dem.net/documents/70/codebook_v16.pdf",
                },
              },
            ],
          }),
        )
      }),
    )
    show(saved)
    const warnings = within(await screen.findByRole("list", { name: "Flagged values" }))
    expect(warnings.getByText("Estimate 0.865; 68% HPD interval 0.828–0.914 (V16)")).toBeDefined()
    expect(screen.getAllByText(/Coppedge et al.*CC BY-SA 4.0/).length).toBeGreaterThan(0)
    await userEvent.setup().click(screen.getByRole("tab", { name: "Data" }))
    const evidence = within(await screen.findByRole("list", { name: "Flagged values" }))
    expect(evidence.getByText("Estimate 0.865; 68% HPD interval 0.828–0.914 (V16)")).toBeDefined()
  })

  it("shows the published estimate, interval and attribution after restoring a WHO chart", async () => {
    const saved = Trend.make({
      indicator: IndicatorId.make("WHO:WHOSIS_000001"),
      countries: ["FRA"],
      from: Year.make(2025),
      to: Year.make(2025),
    })

    network.use(
      http.post("/api/views/resolve", async ({ request }) => {
        const view = Schema.decodeUnknownSync(Trend)(await request.json())

        return HttpResponse.json(
          Schema.encodeSync(ResolvedViewSchema)({
            ...resolvedFor(view),
            observations: [
              { country: "FRA", year: Year.make(2025), value: 81.9, flags: ["Estimated"] },
            ],
            sources: [
              {
                ...source(view.indicator),
                source: "WHO",
                dataset:
                  "World Health Organization; Global Health Estimates; CC BY 4.0 with WHO additional terms",
                url: "https://xmart-api-public.who.int/DATA_/RELAY_MAY2023",
              },
            ],
            qualifications: [
              {
                source: "WHO",
                series: { indicator: view.indicator, dimensions: {} },
                country: "FRA",
                year: Year.make(2025),
                missing: false,
                notes: [],
                level: 0.95,
                method: "MonteCarloQuantiles",
                methodUrl:
                  "https://cdn.who.int/media/docs/default-source/gho-documents/global-health-estimates/ghe2023_lifetable_methods.pdf?sfvrsn=d5132ed3_2",
                version: "WHO-row.1",
                estimate: 81.9,
                lower: 81.7,
                upper: 82.1,
              },
            ],
          }),
        )
      }),
    )
    show(saved)
    const warnings = within(await screen.findByRole("list", { name: "Flagged values" }))
    expect(
      warnings.getByText("WHO estimate 81.9; 95% uncertainty bounds 81.7–82.1 (WHO-row.1)."),
    ).toBeDefined()
    expect(screen.getAllByText(/World Health Organization.*CC BY 4.0/).length).toBeGreaterThan(0)
    await userEvent.setup().click(screen.getByRole("tab", { name: "Data" }))
    const evidence = within(await screen.findByRole("list", { name: "Flagged values" }))
    expect(
      evidence.getByText("WHO estimate 81.9; 95% uncertainty bounds 81.7–82.1 (WHO-row.1)."),
    ).toBeDefined()
  })

  it("retains each WID input and quality note on a restored chart", async () => {
    network.use(
      http.get("/api/indicators/:indicator/notes", () => new HttpResponse(null, { status: 404 })),
    )

    const saved = Trend.make({
      indicator: IndicatorId.make("WID:sptinc992j"),
      countries: ["FRA", "SWE"],
      from: Year.make(1991),
      to: Year.make(1991),
    })

    const inputs = Schema.decodeUnknownSync(Schema.NonEmptyArray(Input))(
      ["FR", "SE"].flatMap((country) =>
        ["data", "metadata"].map((kind) => ({
          url: `https://wid.world/bulk_download/WID_${kind}_${country}.csv`,
          retrievedAt: DateTime.makeUnsafe("2026-11-11T00:00:00Z"),
          version: `recorded-${country}-${kind}`,
          etag: `"recorded-${country}-${kind}"`,
          lastModified: "Fri, 06 Nov 2026 17:03:44 GMT",
          sha256: "a".repeat(64),
        })),
      ),
    )

    network.use(
      http.post("/api/views/resolve", async ({ request }) => {
        const view = Schema.decodeUnknownSync(Trend)(await request.json())

        return HttpResponse.json(
          Schema.encodeSync(ResolvedViewSchema)({
            ...resolvedFor(view),
            observations: [
              { country: "FRA", year: Year.make(1991), value: 0.2194 },
              { country: "SWE", year: Year.make(1991), value: 0.2628 },
            ],
            sources: [
              {
                ...source(view.indicator),
                source: "WID",
                dataset: "World Inequality Database, sptinc992j",
                url: "https://wid.world/data/",
                inputs,
              },
            ],
            qualifications: [
              {
                source: "WID",
                series: { indicator: view.indicator, dimensions: {} },
                country: "FRA",
                year: Year.make(1991),
                missing: false,
                status: { code: "5", label: "Tax and survey microdata" },
                notes: [
                  {
                    category: "Quality",
                    code: "data_quality",
                    label: "https://wid.world/data-quality/",
                  },
                ],
              },
            ],
          }),
        )
      }),
    )
    show(saved)
    const evidence = within(await screen.findByRole("list", { name: "Flagged values" }))
    expect(evidence.getByText(/Tax and survey microdata/)).toBeDefined()

    for (const input of inputs)
      expect(
        screen.getAllByText(
          (_, element) =>
            element?.tagName === "P" && (element.textContent?.includes(input.url) ?? false),
        ).length,
      ).toBeGreaterThan(0)
    await userEvent.setup().click(screen.getByRole("tab", { name: "About" }))

    for (const input of inputs)
      expect(screen.getByRole("link", { name: input.url }).getAttribute("href")).toBe(input.url)
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
            direction: resolved.direction,
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

  it("keeps a year no country has a value for on the axis, so no line crosses it", async () => {
    // Every other year, as the Worldwide Governance Indicators start.
    const view = Trend.make({
      ...trend,
      countries: ["FRA"],
      from: Year.make(1996),
      to: Year.make(2003),
    })

    const values = [1996, 1998, 2000, 2002, 2003].map((year) => ({
      country: "FRA" as const,
      year: Year.make(year),
      value: year - 2000,
    }))

    network.use(
      http.post("/api/views/resolve", () =>
        HttpResponse.json(
          Schema.encodeSync(ResolvedViewSchema)({
            ...resolvedFor(view),
            missing: [],
            observations: values,
          }),
        ),
      ),
    )

    // A box for the chart, and a line's height for its legend, which
    // Recharts takes off the plot's.
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("recharts-legend-wrapper")
          ? new DOMRect(0, 0, 800, 24)
          : new DOMRect(0, 0, 800, 320)
      })

    try {
      const user = userEvent.setup()

      show(view)

      const shown = await screen.findByRole("figure")
      const figure = within(shown)

      // The tooltip steps through every year: two steps from 1996, past the
      // empty 1997, is 1998's value.
      await figure.findByRole("button", { name: "France" })
      await user.click(figure.getByRole("application"))
      await user.keyboard("{ArrowRight}{ArrowRight}")

      expect(await figure.findByText("-2")).toBeDefined()

      // One line, from 2002 to 2003; the years before it stand alone, each a dot.
      const line = shown.querySelector(".recharts-line-curve")?.getAttribute("d") ?? ""

      expect(line.match(/L/g)).toHaveLength(1)
      expect(shown.querySelectorAll(".recharts-line-dots circle")).toHaveLength(3)
    } finally {
      bounds.mockRestore()
    }
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
            direction: resolved.direction,
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

  it("says it is searching until the results for the text typed arrive", async () => {
    const gated = gatedSearch()
    network.use(worldBank, gated.handler)
    const user = userEvent.setup()

    show(trend)

    const indicator = await screen.findByRole("combobox", { name: "Indicator" })

    await user.tripleClick(indicator)
    await user.keyboard("zz")

    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Searching…")

    gated.release()

    await vi.waitFor(() =>
      expect(screen.getByRole("status")).toHaveProperty("textContent", "No indicator matches."),
    )

    await user.keyboard("{Backspace}{Backspace}gdp")

    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Searching…")

    gated.release()

    expect(await screen.findByRole("option", { name: "GDP (current US$)" })).toBeDefined()
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("lists only the current indicator once a pick clears the search", async () => {
    network.use(worldBank, search)
    const user = userEvent.setup()

    show(trend)

    const indicator = await screen.findByRole("combobox", { name: "Indicator" })

    await user.tripleClick(indicator)
    await user.keyboard("gdp")
    await user.click(await screen.findByRole("option", { name: "GDP (current US$)" }))
    await screen.findByRole("heading", { name: "GDP (current US$)" })

    await user.click(indicator)

    await vi.waitFor(() =>
      expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
        "GDP (current US$)",
      ]),
    )
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
      "Indicator search is not available. Try again in a moment.",
    )
  })

  it("ranks the first 25 of 30 countries, and all 30 once asked", async () => {
    const [first, ...rest] = economies
    const thirty = [first.code, ...rest.slice(0, 29).map(({ code }) => code)] as const
    const view = Ranking.make({ indicator: population, countries: thirty, year: Year.make(2020) })

    network.use(
      notes,
      search,
      http.post("/api/views/resolve", () =>
        HttpResponse.json(
          Schema.encodeSync(ResolvedViewSchema)({
            ...resolvedFor(view),
            missing: [],
            observations: thirty.map((country, index) => ({
              country,
              year: Year.make(2020),
              value: index + 1,
            })),
          }),
        ),
      ),
    )

    const bounds = layOut()

    try {
      const user = userEvent.setup()

      show(view)

      const shown = await screen.findByRole("figure")
      const bars = () => shown.querySelectorAll(".recharts-bar-rectangle")

      await vi.waitFor(() => expect(bars()).toHaveLength(25))

      await user.click(within(shown).getByRole("button", { name: "Show all 30 countries" }))

      await vi.waitFor(() => expect(bars()).toHaveLength(30))
      expect(within(shown).queryByRole("button", { name: /Show all/ })).toBeNull()
    } finally {
      bounds.mockRestore()
    }
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

  it("draws a trend of European countries on a map of Europe, with the outermost regions", async () => {
    network.use(worldBank)
    const user = userEvent.setup()

    show(trend)

    await screen.findByRole("heading", { name: "Total population" })
    await user.click(screen.getByRole("button", { name: "Map ranking one year" }))

    expect(
      await screen.findByRole("figure", {
        name: "Map of Europe ranking countries by Total population",
      }),
    ).toBeDefined()
    expect(screen.getByText("French Guiana")).toBeDefined()
    expect(screen.getByText("Réunion")).toBeDefined()
    expect(screen.getByText("Azores")).toBeDefined()
    expect(screen.getByText("No data")).toBeDefined()
    expect(screen.getByRole("combobox", { name: "Year" }).textContent).toContain("2020")
  })

  // Answers a ranking with a value for every country asked for.
  const everywhere = http.post("/api/views/resolve", async ({ request }) => {
    const view = Schema.decodeUnknownSync(View)(await request.json())
    const resolved = resolvedFor(view)

    return HttpResponse.json(
      Schema.encodeSync(ResolvedViewSchema)({
        ...resolved,
        observations: view.countries.map((country, index) => ({
          country,
          year: Year.make(2020),
          value: 1000 * (index + 1),
        })),
        missing: [],
      }),
    )
  })

  it.each([
    [["USA"], "Map of United States", ["Alaska", "Hawaii", "District of Columbia"]],
    [["USA", "MEX"], "Map of North America", ["Hawaii"]],
    [["MEX", "GTM"], "Map of Central America", []],
    [["SAU", "ARE"], "Map of the Gulf states", []],
    [["EGY", "MAR"], "Map of North Africa", []],
    [["RUS", "CHN"], "Map of Northeast Asia", []],
    [["RUS", "UKR"], "Map of the post-Soviet states", []],
    [["FRA", "USA"], "World map", []],
  ] as const)("draws %j on the %s", async (countries, title, insets) => {
    network.use(everywhere)

    show(Ranking.make({ indicator: population, countries, year: Year.make(2020), as: "Map" }))

    expect(
      await screen.findByRole("figure", { name: `${title} ranking countries by Total population` }),
    ).toBeDefined()
    expect(screen.queryByText("French Guiana")).toBeNull()
    expect(insets.filter((name) => screen.queryByText(name) === null)).toEqual([])
  })

  it("draws European countries with Russia on a map of Europe and Russia, with the outermost regions", async () => {
    network.use(everywhere)

    show(
      Ranking.make({
        indicator: population,
        countries: ["FRA", "DEU", "TUR", "RUS"],
        year: Year.make(2020),
        as: "Map",
      }),
    )

    expect(
      await screen.findByRole("figure", {
        name: "Map of Europe and Russia ranking countries by Total population",
      }),
    ).toBeDefined()
    expect(screen.getByText("French Guiana")).toBeDefined()
  })

  it.each(["California", "Alaska", "Hawaii", "District of Columbia"])(
    "names %s on the US map",
    async (name) => {
      network.use(everywhere)
      const user = userEvent.setup()
      show(
        Ranking.make({
          indicator: population,
          countries: ["USA"],
          year: Year.make(2020),
          as: "Map",
        }),
      )
      const map = await screen.findByRole("figure", { name: /^Map of United States/ })
      expect(within(map).getAllByRole("img")).toHaveLength(51)
      await user.hover(within(map).getByRole("img", { name }))
      expect((await screen.findByRole("tooltip")).textContent).toBe(name)
    },
  )

  it("names an enlarged region when reached by keyboard", async () => {
    network.use(everywhere)
    const user = userEvent.setup()
    show(
      Ranking.make({ indicator: population, countries: ["USA"], year: Year.make(2020), as: "Map" }),
    )
    const map = await screen.findByRole("figure", { name: /^Map of United States/ })
    act(() => within(map).getByRole("img", { name: "Hawaii" }).focus())
    await user.tab()
    expect(document.activeElement).toBe(
      within(map).getByRole("img", { name: "District of Columbia" }),
    )
    await vi.waitFor(() =>
      expect(screen.getByRole("tooltip").textContent).toBe("District of Columbia"),
    )
    expect(
      within(map).getByText(
        "Shows the 50 states and Washington, DC. US territories are not shown.",
        { exact: false },
      ),
    ).toBeDefined()
    expect(within(map).getByText("Insets use different scales.", { exact: false })).toBeDefined()
  })

  it.each([
    ["MEX", "Mexico", "Revillagigedo Islands"],
    ["MEX", "Mexico", "Guadalupe Island"],
    ["CHL", "Chile", "Rapa Nui"],
    ["CHL", "Chile", "Salas y Gómez"],
    ["CHL", "Chile", "Juan Fernández Islands"],
    ["CHL", "Chile", "Desventuradas Islands"],
    ["COL", "Colombia", "Malpelo Island"],
    ["JPN", "Japan", "Tokyo offshore islands"],
    ["ZAF", "South Africa", "Western Cape offshore islands"],
  ] as const)("keeps offshore parts of %s in labelled insets", async (country, title, name) => {
    network.use(everywhere)
    show(
      Ranking.make({
        indicator: population,
        countries: [country],
        year: Year.make(2020),
        as: "Map",
      }),
    )

    const map = await screen.findByRole("figure", {
      name: `Map of ${title} ranking countries by Total population`,
    })

    expect(within(map).getByText(name)).toBeDefined()
    expect(within(map).getByText("Insets use different scales.", { exact: false })).toBeDefined()
  })

  it.each([
    [
      "KOR",
      "Sejong",
      /Statistics Korea SGIS \/ vuski\/admdongkor/,
      "CC BY 4.0; upstream KOGL Type 1. Adapted for display.",
      "Shows 16 first-level units after the July 2026 Jeonnam-Gwangju merger.",
    ],
    [
      "PHL",
      "Pateros",
      /NAMRIA \/ PSA via bendlikeabamboo/,
      "CC BY-IGO. Adapted for display.",
      "Shows 82 provinces, 38 independent cities, Pateros and the Special Geographic Area.",
    ],
  ] as const)(
    "credits %s boundaries and keeps its data national",
    async (country, area, publisher, license, scope) => {
      network.use(everywhere)
      const user = userEvent.setup()
      show(
        Ranking.make({
          indicator: population,
          countries: [country],
          year: Year.make(2020),
          as: "Map",
        }),
      )
      const map = await screen.findByRole("figure", { name: /^Map of / })
      expect(within(map).getByRole("link", { name: publisher }).getAttribute("href")).toMatch(
        /^https:/,
      )
      expect(within(map).getByRole("link", { name: license }).getAttribute("href")).toContain(
        "creativecommons.org/licenses/by/",
      )
      expect(within(map).getByText(scope)).toBeDefined()
      expect(within(map).queryByRole("link", { name: /Natural Earth/ })).toBeNull()
      act(() => within(map).getByRole("img", { name: area }).focus())
      await vi.waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe(area))
      await user.click(screen.getByRole("tab", { name: "Data" }))
      const table = await screen.findByRole("table")
      expect(within(table).getAllByRole("row")).toHaveLength(2)
      expect(table.textContent).toContain("1,000")
    },
  )

  it("keeps Indonesia's four new Papua provinces separate despite repeated source codes", async () => {
    network.use(everywhere)
    show(
      Ranking.make({ indicator: population, countries: ["IDN"], year: Year.make(2020), as: "Map" }),
    )
    const map = await screen.findByRole("figure", { name: /^Map of Indonesia/ })

    for (const name of [
      "Papua",
      "Papua Barat",
      "Papua Selatan",
      "Papua Tengah",
      "Papua Pegunungan",
      "Papua Barat Daya",
    ])
      expect(within(map).getByRole("img", { name })).toBeDefined()
  })

  it.each([
    [
      "CUW",
      "Land outside census polygons (context)",
      "Shows 61 census-viewer geozones. Land outside those polygons is shown for location only.",
    ],
    [
      "MAF",
      "Tintamarre (context)",
      "Shows 14 statistical neighbourhoods, distinct from the six neighbourhood councils.",
    ],
  ] as const)("keeps uncovered land neutral for %s", async (country, context, scope) => {
    network.use(everywhere)
    show(
      Ranking.make({
        indicator: population,
        countries: [country],
        year: Year.make(2020),
        as: "Map",
      }),
    )
    const map = await screen.findByRole("figure", { name: /^Map of / })
    expect(within(map).getByText(scope)).toBeDefined()
    expect(
      within(map)
        .getByLabelText(
          (label) =>
            label.startsWith(`${context}, `) &&
            label.includes("Location only; national value not applied"),
        )
        .getAttribute("fill"),
    ).toBe("var(--border)")
  })

  it("offers the adapted Emirati boundary data under its open database licence", async () => {
    network.use(everywhere)
    show(
      Ranking.make({ indicator: population, countries: ["ARE"], year: Year.make(2020), as: "Map" }),
    )
    const map = await screen.findByRole("figure", { name: /^Map of United Arab Emirates/ })
    expect(
      within(map).getByRole("link", { name: "Download boundary data" }).getAttribute("href"),
    ).toBe("/boundaries/ARE.zip")
    expect(
      within(map)
        .getByRole("link", { name: "ODbL 1.0. Adapted for display." })
        .getAttribute("href"),
    ).toBe("https://opendatacommons.org/licenses/odbl/1-0/")
  })

  it("labels Slovenian statistical geography and its open boundary licence", async () => {
    network.use(everywhere)
    show(
      Ranking.make({ indicator: population, countries: ["SVN"], year: Year.make(2020), as: "Map" }),
    )
    const map = await screen.findByRole("figure", { name: /^Map of Slovenia/ })
    expect(within(map).getByText(/Statistical regions/)).toBeDefined()
    expect(
      within(map)
        .getByRole("link", { name: /Geodetska uprava Republike Slovenije/ })
        .getAttribute("href"),
    ).toContain("geohub.gov.si")
    expect(
      within(map)
        .getByRole("link", { name: "CC BY 4.0. Adapted for display." })
        .getAttribute("href"),
    ).toBe("https://creativecommons.org/licenses/by/4.0/")
  })

  it.each([
    ["BDI", ["Buhumuza", "Bujumbura"]],
    ["BFA", ["Soum", "Sourou", "Kadiogo"]],
    ["MDG", ["Ambatosoa", "Vatovavy", "Fitovinany"]],
    ["MLI", ["Taoudenni", "Bandiagara"]],
    ["TZA", ["Songwe", "Mbeya"]],
    ["TLS", ["Atauro", "Dili"]],
    ["AFG", ["Panjshir", "Daykundi", "Parwan", "Uruzgan"]],
    ["MWI", ["Karonga", "Chitipa"]],
    ["MOZ", ["Maputo City", "Maputo Province"]],
  ] as const)("preserves the current distinct areas of %s", async (country, areas) => {
    network.use(everywhere)
    show(
      Ranking.make({
        indicator: population,
        countries: [country],
        year: Year.make(2020),
        as: "Map",
      }),
    )
    const map = await screen.findByRole("figure", { name: /^Map of / })

    for (const name of areas) expect(within(map).getByRole("img", { name })).toBeDefined()
  })

  it("keeps China's mainland geography separate from Hong Kong, Macao and Taiwan", async () => {
    network.use(everywhere)
    show(
      Ranking.make({ indicator: population, countries: ["CHN"], year: Year.make(2020), as: "Map" }),
    )
    const map = await screen.findByRole("figure", { name: /^Map of China/ })
    expect(within(map).getAllByRole("img")).toHaveLength(31)
    expect(within(map).queryByRole("img", { name: /Hong Kong|Macau|Taiwan/ })).toBeNull()
    expect(within(map).getByRole("img", { name: "Guangdong Province" })).toBeDefined()
  })

  it("credits Estonia's dated official boundaries and keeps its value national", async () => {
    network.use(everywhere)
    const user = userEvent.setup()
    show(
      Ranking.make({ indicator: population, countries: ["EST"], year: Year.make(2020), as: "Map" }),
    )
    const map = await screen.findByRole("figure", { name: /^Map of Estonia/ })
    expect(within(map).getByText(/Shows 15 counties/)).toBeDefined()
    expect(
      within(map)
        .getByRole("link", {
          name: "Boundaries: Estonian Land and Spatial Development Board, 12 November 2026.",
        })
        .getAttribute("href"),
    ).toContain("geoportaal.maaruum.ee")
    expect(within(map).queryByRole("link", { name: /Natural Earth/ })).toBeNull()
    act(() => within(map).getByRole("img", { name: "Hiiu" }).focus())
    await vi.waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe("Hiiu"))
    await user.click(screen.getByRole("tab", { name: "Data" }))
    const table = await screen.findByRole("table")
    expect(table.textContent).toContain("Estonia")
    expect(table.textContent).toContain("1,000")
    expect(within(table).getAllByRole("row")).toHaveLength(2)
  })

  it("keeps the two Croatian counties with a duplicated atlas code separate", async () => {
    network.use(everywhere)
    show(
      Ranking.make({ indicator: population, countries: ["HRV"], year: Year.make(2020), as: "Map" }),
    )
    const map = await screen.findByRole("figure", { name: /^Map of Croatia/ })
    expect(within(map).getByRole("img", { name: "Požega-Slavonia" })).toBeDefined()
    expect(within(map).getByRole("img", { name: "Brod-Posavina" })).toBeDefined()
    expect(within(map).getByRole("img", { name: "Zagreb County" })).toBeDefined()
    expect(within(map).getByRole("img", { name: "City of Zagreb" })).toBeDefined()
  })

  it("credits Ireland's current council boundaries and keeps its value national", async () => {
    network.use(everywhere)
    const user = userEvent.setup()
    show(
      Ranking.make({ indicator: population, countries: ["IRL"], year: Year.make(2020), as: "Map" }),
    )
    const map = await screen.findByRole("figure", { name: /^Map of Ireland/ })
    expect(within(map).getByText(/Shows 31 local authority areas/)).toBeDefined()
    expect(within(map).getByRole("img", { name: "Limerick City and County" })).toBeDefined()
    expect(within(map).getByRole("img", { name: "Waterford City and County" })).toBeDefined()
    expect(within(map).queryByRole("img", { name: /North Tipperary|South Tipperary/ })).toBeNull()
    expect(
      within(map)
        .getByRole("link", { name: "Boundaries: © Tailte Éireann, 2024." })
        .getAttribute("href"),
    ).toContain("ed592af6f0444bf1b0becdb5925f9477")
    expect(
      within(map)
        .getByRole("link", { name: "CC BY 4.0. Simplified for display." })
        .getAttribute("href"),
    ).toBe("https://creativecommons.org/licenses/by/4.0/")
    expect(within(map).queryByRole("link", { name: /Natural Earth/ })).toBeNull()
    act(() => within(map).getByRole("img", { name: "Dublin City" }).focus())
    await user.tab()
    expect(document.activeElement).toBe(within(map).getByRole("img", { name: "Cork City" }))
    await vi.waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe("Cork City"))
    await user.click(screen.getByRole("tab", { name: "Data" }))
    const table = await screen.findByRole("table")
    expect(table.textContent).toContain("Ireland")
    expect(table.textContent).toContain("1,000")
    expect(within(table).getAllByRole("row")).toHaveLength(2)
  })

  it("distinguishes Mount Athos from Greece's thirteen regions", async () => {
    network.use(everywhere)
    show(
      Ranking.make({ indicator: population, countries: ["GRC"], year: Year.make(2020), as: "Map" }),
    )
    const map = await screen.findByRole("figure", { name: /^Map of Greece/ })
    expect(
      within(map).getByText(/Shows 13 regions and the self-governed territory of Mount Athos/),
    ).toBeDefined()
  })

  it("labels the UK statistical regions and credits ONS and Ordnance Survey", async () => {
    network.use(everywhere)
    const user = userEvent.setup()
    show(
      Ranking.make({ indicator: population, countries: ["GBR"], year: Year.make(2020), as: "Map" }),
    )
    const map = await screen.findByRole("figure", { name: /^Map of United Kingdom/ })
    expect(within(map).getAllByRole("img")).toHaveLength(12)
    expect(within(map).getByRole("img", { name: "Scotland" })).toBeDefined()
    expect(within(map).getByRole("img", { name: "Wales" })).toBeDefined()
    expect(within(map).getByRole("img", { name: "Northern Ireland" })).toBeDefined()
    await user.hover(within(map).getByRole("img", { name: "London" }))
    expect((await screen.findByRole("tooltip")).textContent).toBe("London")
    expect(within(map).getByText(/UK boundaries show 12 statistical regions/)).toBeDefined()
    expect(
      within(map).getByRole("link", {
        name: "Boundaries: Office for National Statistics, January 2025.",
      }),
    ).toBeDefined()
    expect(
      within(map).getByText("Contains OS data © Crown copyright and database right 2025", {
        exact: false,
      }),
    ).toBeDefined()
    expect(within(map).queryByRole("link", { name: /Natural Earth/ })).toBeNull()
  })

  it("keeps New Zealand's outlying islands outside the regional count", async () => {
    network.use(everywhere)
    show(
      Ranking.make({ indicator: population, countries: ["NZL"], year: Year.make(2020), as: "Map" }),
    )
    const map = await screen.findByRole("figure", { name: /^Map of New Zealand/ })
    expect(within(map).getAllByRole("img")).toHaveLength(17)
    expect(
      within(map)
        .getByLabelText(
          "Three Kings Islands, New Zealand: Location only; national value not applied.",
        )
        .getAttribute("fill"),
    ).toBe("var(--border)")
    expect(
      within(map)
        .getByLabelText("Kermadec Islands, New Zealand: Location only; national value not applied.")
        .getAttribute("fill"),
    ).toBe("var(--border)")
    expect(
      within(map)
        .getByLabelText(
          "Subantarctic islands, New Zealand: Location only; national value not applied.",
        )
        .getAttribute("fill"),
    ).toBe("var(--border)")
    expect(within(map).queryByRole("img", { name: "Tokelau" })).toBeNull()
    expect(
      within(map).getByText(/The Cook Islands, Niue and Tokelau are not included/),
    ).toBeDefined()
  })

  it("withholds the Dutch national colour from Caribbean municipalities", async () => {
    network.use(everywhere)
    show(
      Ranking.make({ indicator: population, countries: ["NLD"], year: Year.make(2020), as: "Map" }),
    )
    const map = await screen.findByRole("figure", { name: /^Map of Netherlands/ })
    const value = within(map).getByLabelText("Netherlands: 1,000").getAttribute("fill")
    expect(value).not.toBe("var(--border)")
    expect(
      within(map)
        .getByLabelText("Bonaire, Netherlands: Location only; national value not applied.")
        .getAttribute("fill"),
    ).toBe("var(--border)")
    expect(
      within(map)
        .getByLabelText("St. Eustatius, Netherlands: Location only; national value not applied.")
        .getAttribute("fill"),
    ).toBe("var(--border)")
    expect(
      within(map)
        .getByLabelText("Saba, Netherlands: Location only; national value not applied.")
        .getAttribute("fill"),
    ).toBe("var(--border)")
    expect(
      within(map).getByText(
        "Caribbean municipalities are shown for location only; the national value is not applied to them.",
        { exact: false },
      ),
    ).toBeDefined()
  })

  it("shows all Länder on a Germany-only map and keeps the value national", async () => {
    network.use(everywhere)
    const user = userEvent.setup()

    show(
      Ranking.make({ indicator: population, countries: ["DEU"], year: Year.make(2020), as: "Map" }),
    )

    const map = await screen.findByRole("figure", { name: /^Map of Germany/ })
    const areas = within(map)

    expect(areas.getAllByRole("img")).toHaveLength(16)

    for (const name of ["Berlin", "Hamburg", "Bremen", "Bayern", "Thüringen"])
      expect(areas.getByRole("img", { name }).getAttribute("tabindex")).toBe("0")
    expect(
      areas.getByText(
        "Borders show regions. Colour shows the national value, not regional values.",
        { exact: false },
      ),
    ).toBeDefined()
    expect(
      areas
        .getByRole("link", { name: "Boundaries: Natural Earth, Admin 1, v5.1.2." })
        .getAttribute("href"),
    ).toContain("naturalearthdata.com")

    await user.hover(areas.getByRole("img", { name: "Bayern" }))
    expect((await screen.findByRole("tooltip")).textContent).toBe("Bayern")
    await user.unhover(areas.getByRole("img", { name: "Bayern" }))
    act(() => areas.getByRole("img", { name: "Berlin" }).focus())
    await vi.waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe("Berlin"))
    await user.click(screen.getByRole("tab", { name: "Data" }))
    expect((await screen.findByRole("table")).textContent).toContain("Germany")
    expect(screen.getByRole("table").textContent).toContain("1,000")
  })

  it("names the country and its value when the pointer is over it on a map", async () => {
    network.use(everywhere)
    const user = userEvent.setup()

    show(
      Ranking.make({
        indicator: population,
        countries: ["FRA", "DEU"],
        year: Year.make(2020),
        as: "Map",
      }),
    )
    await screen.findByRole("figure", { name: /^Map of Europe/ })
    expect(screen.queryByRole("img", { name: "Bayern" })).toBeNull()

    await user.hover(outline("France"))
    expect((await screen.findByRole("tooltip")).textContent).toBe("France: 1,000")

    await user.hover(outline("Germany"))
    await vi.waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe("Germany: 2,000"))
  })

  // France, Germany and Italy from 2017 to 2020: Germany and Italy have
  // values from 2019 only.
  const overTime = Ranking.make({
    indicator: population,
    countries: ["FRA", "DEU", "ITA"],
    year: Year.make(2020),
    span: { from: Year.make(2017), to: Year.make(2020) },
  })

  it("moves a ranking over time with the arrow keys, and keeps the year in its link", async () => {
    network.use(worldBank)
    const user = userEvent.setup()
    const bounds = layOut()

    try {
      const page = show(overTime)

      const shown = (
        await screen.findByText("Bar chart ranking countries by Total population")
      ).closest("figure")!

      const bars = () => shown.querySelectorAll(".recharts-bar-rectangle")
      const year = await screen.findByRole("slider", { name: "Year" })

      await vi.waitFor(() => expect(bars()).toHaveLength(3))
      expect(screen.getByText("France, Germany, and Italy · 2017–2020")).toBeDefined()

      act(() => year.focus())
      await user.keyboard("{ArrowLeft}{ArrowLeft}")

      expect(await screen.findByText("No data in 2018 for Germany, Italy.")).toBeDefined()
      await vi.waitFor(() => expect(bars()).toHaveLength(1))

      await user.click(screen.getByRole("button", { name: "Copy link" }))
      expect(await screen.findByRole("button", { name: "Link copied" })).toBeDefined()

      const link = new URL(await navigator.clipboard.readText())

      expect(Object.fromEntries(link.searchParams)).toMatchObject({
        chart: "ranking",
        year: "2018",
        from: "2017",
        to: "2020",
      })

      // Reopened from its link, the chart shows the year it was left on.
      page.unmount()
      show(fromUrl(link))

      expect(await screen.findByText("No data in 2018 for Germany, Italy.")).toBeDefined()
    } finally {
      bounds.mockRestore()
    }
  })

  it("plays a ranking over time from its first year, and keeps the year it pauses on", async () => {
    network.use(worldBank)
    const user = userEvent.setup()
    const page = show(overTime)

    await screen.findByText("Bar chart ranking countries by Total population")
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })

    try {
      // At its last year, play starts again from the first.
      await user.click(screen.getByRole("button", { name: "Play" }))
      expect(screen.getByRole("status").textContent).toBe("2017")

      second()
      expect(screen.getByRole("status").textContent).toBe("2018")
      expect(screen.getByText("No data in 2018 for Germany, Italy.")).toBeDefined()

      await user.click(screen.getByRole("button", { name: "Pause" }))
      second()
      second()
      second()
      expect(screen.getByRole("status").textContent).toBe("2018")
    } finally {
      vi.useRealTimers()
    }

    await user.click(screen.getByRole("button", { name: "Copy link" }))
    expect(await screen.findByRole("button", { name: "Link copied" })).toBeDefined()

    const link = new URL(await navigator.clipboard.readText())

    expect(link.searchParams.get("year")).toBe("2018")

    page.unmount()
    show(fromUrl(link))

    expect(await screen.findByText("No data in 2018 for Germany, Italy.")).toBeDefined()
  })

  it("stops play at the last year, and pauses when the reader moves the slider", async () => {
    network.use(worldBank)
    const user = userEvent.setup()

    show(Ranking.make({ ...overTime, year: Year.make(2018) }))

    await screen.findByText("Bar chart ranking countries by Total population")
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })

    try {
      await user.click(screen.getByRole("button", { name: "Play" }))
      second()
      second()
      second()

      expect(screen.getByRole("status").textContent).toBe("2020")
      expect(screen.getByRole("button", { name: "Play" })).toBeDefined()

      await user.click(screen.getByRole("button", { name: "Play" }))
      second()
      expect(screen.getByRole("status").textContent).toBe("2018")

      act(() => screen.getByRole("slider", { name: "Year" }).focus())
      await user.keyboard("{ArrowRight}")
      second()
      second()
      second()

      expect(screen.getByRole("status").textContent).toBe("2019")
      expect(screen.getByRole("button", { name: "Play" })).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it("moves a relation's dots through its span, tracing their paths only while paused", async () => {
    network.use(worldBank)
    const user = userEvent.setup()
    const bounds = layOut()

    try {
      show(
        Relation.make({
          indicator: population,
          against: IndicatorId.make("NY.GDP.PCAP.CD"),
          countries: ["FRA", "DEU"],
          year: Year.make(2020),
          span: { from: Year.make(2017), to: Year.make(2020) },
        }),
      )

      const shown = (await screen.findByText(/^Scatter plot of Total population against/)).closest(
        "figure",
      )!

      const lines = () => shown.querySelectorAll(".recharts-scatter-line")

      expect(screen.getByText("Lines trace each country from 2017 to 2020.")).toBeDefined()
      await vi.waitFor(() => expect(lines()).toHaveLength(2))

      act(() => screen.getByRole("slider", { name: "Year" }).focus())
      await user.keyboard("{ArrowLeft}{ArrowLeft}")

      expect(await screen.findByText("No data in 2018 for Germany.")).toBeDefined()
      expect(screen.getByText("Lines trace each country from 2017 to 2018.")).toBeDefined()
      await vi.waitFor(() => expect(lines()).toHaveLength(1))

      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })

      try {
        await user.click(screen.getByRole("button", { name: "Play" }))
        second()

        expect(screen.getByRole("status").textContent).toBe("2019")
        expect(screen.queryByText(/^Lines trace/)).toBeNull()
        await vi.waitFor(() => expect(lines()).toHaveLength(0))

        await user.click(screen.getByRole("button", { name: "Pause" }))

        expect(screen.getByText("Lines trace each country from 2017 to 2019.")).toBeDefined()
      } finally {
        vi.useRealTimers()
      }
    } finally {
      bounds.mockRestore()
    }
  })

  it("switches a relation to over time, from the first year both indicators share", async () => {
    network.use(worldBank)
    const user = userEvent.setup()

    show(
      Relation.make({
        indicator: population,
        against: IndicatorId.make("NY.GDP.PCAP.CD"),
        countries: ["FRA", "DEU"],
        year: Year.make(2020),
      }),
    )

    await screen.findByText(/^Scatter plot of Total population against/)
    await user.click(screen.getByRole("button", { name: "Over time" }))

    expect(await screen.findByRole("slider", { name: "Year" })).toBeDefined()
    expect(screen.getByText("France and Germany · 2019–2020")).toBeDefined()

    await user.click(screen.getByRole("button", { name: "One year" }))

    expect(await screen.findByText("France and Germany · 2020")).toBeDefined()
    expect(screen.queryByRole("slider", { name: "Year" })).toBeNull()
  })

  it("asks for a ranking over time's span once, whichever year it shows", async () => {
    const asked: Array<View> = []

    network.use(
      http.post("/api/views/resolve", async ({ request }) => {
        const view = Schema.decodeUnknownSync(View)(await request.json())

        asked.push(view)

        return HttpResponse.json(Schema.encodeSync(ResolvedViewSchema)(resolvedFor(view)))
      }),
    )

    const user = userEvent.setup()

    show(overTime)

    await screen.findByText("Bar chart ranking countries by Total population")
    act(() => screen.getByRole("slider", { name: "Year" }).focus())
    await user.keyboard("{ArrowLeft}")

    expect(await screen.findByText("2019")).toBeDefined()
    expect(asked).toEqual([overTime])
  })

  it("switches a ranking to over time, from the first year its countries share, and back", async () => {
    network.use(worldBank)
    const user = userEvent.setup()

    show(Ranking.make({ indicator: population, countries: ["FRA", "DEU"], year: Year.make(2020) }))

    await screen.findByText("Bar chart ranking countries by Total population")
    expect(screen.queryByRole("slider", { name: "Year" })).toBeNull()

    await user.click(screen.getByRole("button", { name: "Over time" }))

    expect(await screen.findByRole("slider", { name: "Year" })).toBeDefined()
    expect(screen.getByText("France and Germany · 2019–2020")).toBeDefined()
    expect(screen.getByRole("combobox", { name: "From" }).textContent).toContain("2019")
    expect(screen.getByRole("combobox", { name: "To" }).textContent).toContain("2020")

    await user.click(screen.getByRole("button", { name: "One year" }))

    expect(await screen.findByText("France and Germany · 2020")).toBeDefined()
    expect(screen.queryByRole("slider", { name: "Year" })).toBeNull()
    expect(screen.getByRole("combobox", { name: "Year" }).textContent).toContain("2020")
  })

  it("keeps a chart type picked while the history for over time still loads", async () => {
    const { promise: loaded, resolve: load } = Promise.withResolvers<void>()

    network.use(
      http.post("/api/views/resolve", async ({ request }) => {
        const view = Schema.decodeUnknownSync(View)(await request.json())

        // The whole history, which "Over time" loads first, waits.
        const whole = Match.value(view).pipe(
          Match.tag("Trend", ({ from }) => from === 1960),
          Match.orElse(() => false),
        )

        if (whole) await loaded

        return HttpResponse.json(Schema.encodeSync(ResolvedViewSchema)(resolvedFor(view)))
      }),
    )

    const user = userEvent.setup()

    show(Ranking.make({ indicator: population, countries: ["FRA", "DEU"], year: Year.make(2020) }))

    await screen.findByText("Bar chart ranking countries by Total population")
    await user.click(screen.getByRole("button", { name: "Over time" }))
    await user.click(screen.getByRole("button", { name: "Line chart over years" }))

    expect(await screen.findByRole("combobox", { name: "From" })).toBeDefined()

    load()

    // The trend's own history arrives with the one "Over time" asked for.
    expect(await screen.findByRole("slider", { name: "First year" })).toBeDefined()
    expect(screen.getByRole("combobox", { name: "From" })).toBeDefined()
    expect(screen.queryByText("Bar chart ranking countries by Total population")).toBeNull()
  })

  it("takes the slider away while a ranking over time's new span loads, then moves through it", async () => {
    const shortened = holding((view) =>
      Match.value(view).pipe(
        Match.tag("Ranking", ({ span }) => span?.to === 2019),
        Match.orElse(() => false),
      ),
    )

    network.use(shortened.handler)
    const user = userEvent.setup()

    show(overTime)

    await screen.findByRole("slider", { name: "Year" })
    await user.click(screen.getByRole("combobox", { name: "To" }))
    await user.click(await screen.findByRole("option", { name: "2019" }))

    // The chart of 2017 to 2020 stays on screen, with nothing to move it.
    expect(await screen.findByText("France, Germany, and Italy · 2017–2019")).toBeDefined()
    expect(screen.getByText("Bar chart ranking countries by Total population")).toBeDefined()
    expect(screen.queryByRole("slider", { name: "Year" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull()

    shortened.release()

    const year = await screen.findByRole("slider", { name: "Year" })

    expect(year.getAttribute("max")).toBe("2019")
    expect(screen.getByRole("status").textContent).toBe("2019")
  })

  it("shades a map over time by value on a key that stays the same in every year", async () => {
    network.use(worldBank)
    const user = userEvent.setup()

    show(Ranking.make({ ...overTime, as: "Map" }))

    expect(
      await screen.findByRole("figure", {
        name: "Map of Europe shading countries by Total population",
      }),
    ).toBeDefined()

    const before = mapKey()

    act(() => screen.getByRole("slider", { name: "Year" }).focus())
    await user.keyboard("{Home}")

    expect(await screen.findByText("No data in 2017 for Germany, Italy.")).toBeDefined()
    expect(mapKey()).toEqual(before)
    expect(before).toHaveLength(6)
  })

  it("shades a map of unemployment from green for the lowest to red, and says lower is better", async () => {
    network.use(worldBank)

    show(
      Ranking.make({
        indicator: unemployment,
        countries: ["FRA", "DEU", "ITA"],
        year: Year.make(2020),
        as: "Map",
      }),
    )

    expect(
      await screen.findByRole("figure", {
        name: "Map of Europe ranking countries by Unemployment, total (% of total labor force), lower is better",
      }),
    ).toBeDefined()
    expect(mapKey()[0]).toBe("Lower is better")
    expect(shadeOf("Italy")).toBe("var(--chart-better)")
    expect(shadeOf("Germany")).toContain("var(--chart-worse)")
  })

  it("keeps a map of an indicator nobody checked blue, with no direction in its key", async () => {
    network.use(worldBank)

    show(
      Ranking.make({
        indicator: population,
        countries: ["FRA", "DEU", "ITA"],
        year: Year.make(2020),
        as: "Map",
      }),
    )

    await screen.findByRole("figure", {
      name: "Map of Europe ranking countries by Total population",
    })

    expect(mapKey().filter((entry) => entry?.includes("is better"))).toEqual([])
    expect(shadeOf("Italy")).toContain("var(--chart-1)")
  })

  it("draws a fall in unemployment as a move the better way", async () => {
    network.use(worldBank)
    const bounds = layOut()

    try {
      show(
        Change.make({
          indicator: unemployment,
          countries: ["ITA"],
          from: Year.make(2019),
          to: Year.make(2020),
        }),
      )

      const caption = await screen.findByText(
        "Change in Unemployment, total (% of total labor force) between 2019 and 2020, by country, lower is better",
      )

      const figure = within(caption.closest("figure")!)

      expect(figure.getByText("Lower is better")).toBeDefined()
      expect(await figure.findByText("2020, better")).toBeDefined()
      expect(figure.queryByText("2020, worse")).toBeNull()
    } finally {
      bounds.mockRestore()
    }
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

  it("shows no year window while the new indicator's history loads", async () => {
    const life = IndicatorId.make("SP.DYN.LE00.IN")
    const history = holding((view) => view.indicator === life && isHistory(view))

    network.use(history.handler, search)
    const user = userEvent.setup()

    show(trend)

    await screen.findByRole("slider", { name: "First year" })

    const indicator = screen.getByRole("combobox", { name: "Indicator" })

    await user.tripleClick(indicator)
    await user.keyboard("life")
    await user.click(
      await screen.findByRole("option", { name: "Life expectancy at birth, total (years)" }),
    )

    expect(
      await screen.findByRole("heading", { name: "Life expectancy at birth, total (years)" }),
    ).toBeDefined()
    expect(screen.queryByRole("slider", { name: "First year" })).toBeNull()

    history.release()

    expect(await screen.findByRole("slider", { name: "First year" })).toBeDefined()
  })

  it("says when a trend's history cannot be loaded, and keeps its chart", async () => {
    network.use(
      http.post("/api/views/resolve", async ({ request }) => {
        const view = Schema.decodeUnknownSync(View)(await request.json())

        return isHistory(view)
          ? HttpResponse.json(
              Schema.encodeSync(SourceUnavailable)(new SourceUnavailable({ source: "World Bank" })),
              { status: 503 },
            )
          : HttpResponse.json(Schema.encodeSync(ResolvedViewSchema)(resolvedFor(view)))
      }),
    )

    show(trend)

    expect(await screen.findByText("The chart's history could not be loaded")).toBeDefined()
    expect(screen.getByRole("heading", { name: "Total population" })).toBeDefined()
    expect(screen.queryByRole("slider", { name: "First year" })).toBeNull()
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
    expect(screen.getByText("France grew, as a trend shows.").parentElement?.className).toContain(
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

  it("drops an explanation's error once the chart it was asked for is changed", async () => {
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

    await user.click(screen.getByRole("button", { name: "Bar chart ranking one year" }))

    expect(await screen.findByText("France and Germany · 2020")).toBeDefined()
    expect(screen.queryByText("Too many questions in a minute")).toBeNull()
  })

  it("shows each paragraph of a source's definition as text", async () => {
    network.use(
      http.post("/api/views/resolve", async ({ request }) => {
        const view = Schema.decodeUnknownSync(Trend)(await request.json())

        return HttpResponse.json(
          Schema.encodeSync(ResolvedViewSchema)({
            ...resolvedFor(view),
            // As the server sends Eurostat's HTML description: as text, a
            // blank line between paragraphs.
            indicator: {
              id: population,
              name: "Population, total",
              definition:
                "The number of persons having their usual residence in a country.\n\nWhen usually resident population is not available, countries may report legal residents.",
            },
          }),
        )
      }),
      notes,
      search,
    )
    const user = userEvent.setup()

    show(trend)

    await screen.findByRole("heading", { name: "Total population" })
    await user.click(screen.getByRole("tab", { name: "About" }))

    const first = await screen.findByText(
      "The number of persons having their usual residence in a country.",
    )

    expect(first.tagName).toBe("P")
    expect(
      screen.getByText(
        "When usually resident population is not available, countries may report legal residents.",
      ).tagName,
    ).toBe("P")
  })

  it("says why the indicator matters, its limitations, who produced it, and switches to a related one", async () => {
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

    expect(
      within(screen.getByRole("region", { name: "Produced by" }))
        .getByRole("link", { name: "World Population Prospects, United Nations (UN)" })
        .getAttribute("href"),
    ).toBe("https://population.un.org/wpp/")

    const related = within(await screen.findByRole("region", { name: "Related indicators" }))

    expect(related.queryByRole("button", { name: "Population, total" })).toBeNull()
    await user.click(related.getByRole("button", { name: "Population, female" }))

    expect(await screen.findByRole("heading", { name: female })).toBeDefined()
  })
})

it("changes chart framing and number formats without refetching or translating source metadata", async () => {
  const instance = createI18n()
  let requests = 0

  network.use(
    http.post("/api/views/resolve", async ({ request }) => {
      requests++
      const view = Schema.decodeUnknownSync(View)(await request.json())

      return HttpResponse.json(Schema.encodeSync(ResolvedViewSchema)(resolvedFor(view)))
    }),
  )
  show(
    Ranking.make({
      indicator: population,
      countries: ["DEU"],
      year: Year.make(2020),
      transform: "PerPerson",
    }),
    instance,
  )
  await userEvent.click(await screen.findByRole("tab", { name: "Data" }))
  expect(await screen.findByRole("cell", { name: "83.16" })).toBeDefined()

  await act(() => instance.changeLanguage("pt-PT"))

  expect(screen.getByRole("tab", { name: "Dados" })).toBeDefined()
  expect(screen.getByRole("cell", { name: "Alemanha" })).toBeDefined()
  expect(screen.getByRole("cell", { name: "83,16" })).toBeDefined()
  expect(screen.getByRole("heading", { name: "Total population" })).toBeDefined()
  expect(screen.getByText(/Fonte: World Bank, World Development Indicators/)).toBeDefined()
  expect(requests).toBe(1)
})

it.each(["en-US", "fr-FR", "de-DE", "es-ES", "it-IT", "pt-PT", "pt-BR", "zh-CN"])(
  "retains IMF vintage and actual/estimate status on restored charts in %s",
  async (locale) => {
    const instance = createI18n()
    await instance.changeLanguage(locale)

    const saved = Trend.make({
      indicator: IndicatorId.make("IMF:NGDP_RPCH"),
      countries: ["FRA"],
      from: Year.make(2025),
      to: Year.make(2026),
    })

    network.use(
      http.get("/api/indicators/:indicator/notes", () => new HttpResponse(null, { status: 404 })),
      http.post("/api/views/resolve", async ({ request }) => {
        const view = Schema.decodeUnknownSync(Trend)(await request.json())

        return HttpResponse.json(
          Schema.encodeSync(ResolvedViewSchema)({
            ...resolvedFor(view),
            sources: [
              {
                ...source(view.indicator),
                source: "IMF",
                dataset: "World Economic Outlook, Source: IMF",
                url: "https://data.imf.org/en/datasets/IMF.RES:WEO",
              },
            ],
            observations: [
              { country: "FRA", year: Year.make(2025), value: 0.889548 },
              { country: "FRA", year: Year.make(2026), value: 0.411371 },
            ],
            qualifications: [2025, 2026].map((year) => ({
              source: "IMF",
              series: { indicator: view.indicator, dimensions: {} },
              country: "FRA",
              year: Year.make(year),
              missing: false,
              vintage: "2026-10-13T02:00:00Z",
              latestActual: 2025,
              status:
                year === 2025
                  ? { code: "Actual", label: "Publisher-designated actual (revisable)" }
                  : { code: "EstimateProjection", label: "IMF staff estimate/projection" },
              notes: [],
            })),
          }),
        )
      }),
    )
    show(saved, instance)

    const list = within(
      await screen.findByRole("list", {
        name: instance.getFixedT(null, "explore")(($) => $["Flagged values"]),
      }),
    )

    expect(list.getAllByText(/2026-10-13T02:00:00Z/)).toHaveLength(2)
    expect(list.getByText(/IMF staff estimate\/projection/)).toBeDefined()
    expect(list.getByText(/Publisher-designated actual/)).toBeDefined()
    expect(screen.getAllByText(/World Economic Outlook, Source: IMF/).length).toBeGreaterThan(0)
  },
)
