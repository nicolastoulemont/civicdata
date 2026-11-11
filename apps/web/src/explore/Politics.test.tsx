import {
  Country,
  covers,
  Day,
  type Election,
  End,
  type Event,
  type Government,
  IndicatorId,
  Moment,
  type Overlay,
  Politics,
  PoliticsUnavailable,
  type Reform,
  ResolvedView,
  Scope,
  Trend,
  View,
  When,
  Year,
  yearOf,
  yearsOf,
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

const unemployment = IndicatorId.make("SL.UEM.TOTL.ZS")

// Eurostat's pension spending, a chart of the pensions policy area.
const pensions = IndicatorId.make("ESTAT,TPS00103,1.0")

// A government as PPEG records it, valid by default; a test names what it
// asserts on.
const government = (fields: Partial<Government> = {}): Government => ({
  country: "ESP",
  head: "Mariano Rajoy",
  parties: [{ name: "People's Party", abbreviation: "PP" }],
  color: null,
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
    // The source names one head's party, and that party has a colour.
    color: {
      hex: "#EF1C27",
      kind: "representative",
      url: "https://www.wikidata.org/wiki/Q138198#P465",
    },
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

const day = (date: string) => ({ date: Moment.make(date), approximate: false })

const eu27: readonly [Country, ...Array<Country>] = [
  "AUT",
  "BEL",
  "BGR",
  "HRV",
  "CYP",
  "CZE",
  "DNK",
  "EST",
  "FIN",
  "FRA",
  "DEU",
  "GRC",
  "HUN",
  "IRL",
  "ITA",
  "LVA",
  "LTU",
  "LUX",
  "MLT",
  "NLD",
  "POL",
  "PRT",
  "ROU",
  "SVK",
  "SVN",
  "ESP",
  "SWE",
]

// An event as the API answers it, valid by default: the Maastricht Treaty's
// signature.
const event = (fields: Partial<Event> = {}): Event => ({
  id: "maastricht-signature",
  name: "Maastricht Treaty: signature",
  when: When.cases.Point.make({ at: day("1992-02-07") }),
  scope: Scope.cases.Countries.make({
    countries: ["BEL", "DNK", "DEU", "GRC", "ESP", "FRA", "IRL", "ITA", "LUX", "NLD", "PRT", "GBR"],
  }),
  summary: "The treaty created the European Union and the framework for monetary union.",
  sources: [
    {
      publisher: "EUR-Lex",
      title: "Treaty on European Union, Official Journal C 191, 29 July 1992",
      url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:11992M/TXT",
    },
  ],
  kind: "event",
  reach: "european",
  relation: "eu-specific",
  topics: ["institutions"],
  impact: { level: "structural", reason: "The treaty created the EU." },
  ...fields,
})

const events: ReadonlyArray<Event> = [
  event({
    id: "oil-shock-1973",
    name: "First oil shock and recession",
    when: When.cases.Period.make({
      from: { date: Moment.make("1973"), approximate: true },
      to: { date: Moment.make("1975"), approximate: true },
    }),
    scope: Scope.cases.Countries.make({ countries: eu27 }),
    summary: "Supply restrictions and higher oil prices disrupted growth and raised inflation.",
    sources: [
      {
        publisher: "European Central Bank (ECB)",
        title: "Lessons from the 1970s energy crises",
        url: "https://www.ecb.europa.eu/press/blog/date/2026/html/ecb.blog20260807~b7ab24866e.en.html",
      },
    ],
  }),
  event({
    id: "german-reunification",
    name: "German reunification",
    when: When.cases.Point.make({ at: day("1990-10-03") }),
    scope: Scope.cases.Countries.make({ countries: ["DEU"] }),
    summary: "Reunification extended the Federal Republic and Community membership to the east.",
  }),
  event(),
  event({
    id: "maastricht-force",
    name: "Maastricht Treaty: entry into force",
    when: When.cases.Point.make({ at: day("1993-11-01") }),
  }),
]

// A reform as the API answers it, valid by default: France's 2010 pension
// reform.
const reform = (fields: Partial<Reform> = {}): Reform => ({
  id: "fr-pensions-2010-woerth",
  country: "FRA",
  area: "pensions",
  date: Moment.make("2010-11-09"),
  milestone: "adopted",
  name: "Woerth reform",
  summary: "The minimum pension age rose from 60 to 62 by four months per birth cohort.",
  sources: [
    {
      publisher: "Légifrance",
      title: "Loi n° 2010-1330 du 9 novembre 2010 portant réforme des retraites",
      url: "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000023022127",
    },
  ],
  ...fields,
})

// The API's records: the governments, elections and reforms of the countries
// asked for, and the events that concern any of them. The fake answers every
// year's governments and elections, and the events and reforms of the years
// asked for.
const politics = http.get("/api/politics", ({ request }) => {
  const query = new URL(request.url).searchParams
  const from = Number(query.get("from"))
  const to = Number(query.get("to"))

  const countries = Schema.decodeUnknownSync(Schema.Array(Country))(
    (query.get("countries") ?? "").split(","),
  )

  const during = ({ from: first, to: last }: { from: number; to: number | null }) =>
    first <= to && (last ?? to) >= from

  return HttpResponse.json(
    Schema.encodeSync(Politics)({
      governments: recorded.filter((each) => countries.includes(each.country)),
      elections: elections.filter((each) => countries.includes(each.country)),
      events: events.filter(
        (each) =>
          countries.some((country) => covers(each.scope, country)) && during(yearsOf(each.when)),
      ),
      reforms: [reform()].filter(
        (each) =>
          countries.includes(each.country) &&
          during({ from: yearOf(each.date), to: yearOf(each.date) }),
      ),
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
      indicator: { id: trend.indicator, name: "Unemployment, total", definition: "" },
      observations,
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

interface ShowOptions {
  overlays?: ReadonlyArray<Overlay>
  indicator?: IndicatorId
  from?: number
  to?: number
}

const show = (
  countries: readonly [Country, ...Array<Country>],
  { overlays = [], indicator = unemployment, from = 2010, to = 2020 }: ShowOptions = {},
) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Page
        initial={overlays}
        trend={Trend.make({ indicator, countries, from: Year.make(from), to: Year.make(to) })}
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

// Moves the chart's tooltip to a year `after` its first: clicking the chart
// shows its first year, and each arrow key moves on one.
const hover = async (
  user: ReturnType<typeof userEvent.setup>,
  { figure, country, after }: { figure: HTMLElement; country: string; after: number },
) => {
  await within(figure).findByRole("button", { name: country })
  await user.click(within(figure).getByRole("application"))

  if (after > 0) await user.keyboard("{ArrowRight}".repeat(after))
}

const hover2011 = (user: ReturnType<typeof userEvent.setup>, figure: HTMLElement) =>
  hover(user, { figure, country: "Spain", after: 1 })

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

  it("tints a head's band by their party's colour, and leaves one without a colour grey", async () => {
    network.use(resolve, politics)

    show(["ESP"], { overlays: ["governments"] })

    const shown = await screen.findByRole("figure")
    const figure = within(shown)

    await figure.findByText("Pedro Sánchez")

    // One band per head, oldest first: Zapatero's and Rajoy's parties have no
    // sourced colour.
    await vi.waitFor(() =>
      expect(
        [...shown.querySelectorAll(".recharts-reference-area-rect")].map((band) =>
          band.getAttribute("fill"),
        ),
      ).toEqual(["var(--muted-foreground)", "var(--muted-foreground)", "#EF1C27"]),
    )
    expect(figure.getByText(/shaded by head of government and tinted by their party/)).toBeDefined()
    // The source line links the page that sets the colour.
    expect(
      screen.getByRole("link", { name: "Party colour 1, Wikidata" }).getAttribute("href"),
    ).toBe("https://www.wikidata.org/wiki/Q138198#P465")
  })

  it("names each country's government in the tooltip of a trend of two", async () => {
    network.use(resolve, politics)
    const user = userEvent.setup()

    show(["ESP", "PRT"], { overlays: ["governments"] })

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

    show(["ESP", "BRA"], { overlays: ["elections", "governments"] })

    expect(await screen.findByText("No election or government records for Brazil")).toBeDefined()
  })

  it("names no country as unrecorded while the records of a country just added load", async () => {
    const gate = Promise.withResolvers<void>()

    network.use(
      resolve,
      http.get("/api/politics", async ({ request }) => {
        if (new URL(request.url).searchParams.get("countries") === "ESP,PRT") await gate.promise
      }),
      politics,
    )
    const user = userEvent.setup()

    show(["ESP"], { overlays: ["governments"] })

    await within(await screen.findByRole("figure")).findByText("Pedro Sánchez")
    await user.click(screen.getByRole("button", { name: "Change" }))
    await user.type(screen.getByRole("combobox", { name: "Countries" }), "Portu")
    await user.click(await screen.findByRole("option", { name: "Portugal" }))

    expect(await screen.findByText("Spain and Portugal · 2010–2020")).toBeDefined()
    expect(screen.queryByText(/^No government records for/)).toBeNull()
    // Spain's governments stay drawn meanwhile.
    await hover2011(user, screen.getByRole("figure"))
    expect(
      await within(screen.getByRole("figure")).findByText(
        "Spain: Mariano Rajoy · PP · 2011 to 2018",
      ),
    ).toBeDefined()

    gate.resolve()

    const figure = await screen.findByRole("figure")

    await hover2011(user, figure)

    expect(
      await within(figure).findByText("Portugal: Pedro Passos Coelho · PSD, CDS-PP · 2011 to 2015"),
    ).toBeDefined()
    expect(screen.queryByText(/^No government records for/)).toBeNull()
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

    show(["ESP"], { overlays: ["governments"] })

    expect(await screen.findByText("Government records are unavailable")).toBeDefined()
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

describe("Events and reforms on a trend", () => {
  it("bands a period and marks dated events, naming each with its sources", async () => {
    network.use(resolve, politics)
    const user = userEvent.setup()

    show(["FRA"], { from: 1970, to: 1995 })

    await user.click(await screen.findByRole("button", { name: "Events" }))

    const figure = await screen.findByRole("figure")

    // 1973, the year the oil shock's band starts.
    await hover(user, { figure, country: "France", after: 3 })

    expect(
      await within(figure).findByText(
        "First oil shock and recession · about 1973 to about 1975 · Today's 27 EU members · Supply restrictions and higher oil prices disrupted growth and raised inflation. · Source 1 below",
      ),
    ).toBeDefined()

    // 1974, inside the band: its name and dates, without its summary.
    await user.keyboard("{ArrowRight}")

    expect(
      await within(figure).findByText("First oil shock and recession · about 1973 to about 1975"),
    ).toBeDefined()
    expect(within(figure).queryByText(/Supply restrictions/)).toBeNull()

    // 1992 and 1993: the treaty's signature, then its entry into force.
    await user.keyboard("{ArrowRight}".repeat(18))

    expect(
      await within(figure).findByText(/^Maastricht Treaty: signature · 7 February 1992 · /),
    ).toBeDefined()

    await user.keyboard("{ArrowRight}")

    expect(
      await within(figure).findByText(/^Maastricht Treaty: entry into force · 1 November 1993 · /),
    ).toBeDefined()
    expect(within(figure).getByText(/with events marked/)).toBeDefined()
    // The source line links each source the tooltip numbers.
    expect(
      screen
        .getByRole("link", {
          name: "1, European Central Bank (ECB): Lessons from the 1970s energy crises",
        })
        .getAttribute("href"),
    ).toBe(
      "https://www.ecb.europa.eu/press/blog/date/2026/html/ecb.blog20260807~b7ab24866e.en.html",
    )
    // Events credit no election archive.
    expect(screen.queryByRole("link", { name: /PPEG/ })).toBeNull()
  })

  it("leaves out an event that does not concern the chart's countries", async () => {
    network.use(resolve, politics)
    const user = userEvent.setup()

    show(["FRA"], { overlays: ["events"], from: 1990, to: 1995 })

    const figure = await screen.findByRole("figure")

    await hover(user, { figure, country: "France", after: 2 })

    expect(await within(figure).findByText(/^Maastricht Treaty: signature/)).toBeDefined()

    await user.keyboard("{ArrowLeft}{ArrowLeft}")

    // 1990: German reunification concerns Germany only.
    await vi.waitFor(() =>
      expect(within(figure).queryByText(/^Maastricht Treaty: signature/)).toBeNull(),
    )
    expect(within(figure).queryByText(/German reunification/)).toBeNull()
  })

  it("names the country an event concerns on a chart of several", async () => {
    network.use(resolve, politics)
    const user = userEvent.setup()

    show(["FRA", "DEU"], { overlays: ["events"], from: 1990, to: 1995 })

    const figure = await screen.findByRole("figure")

    await hover(user, { figure, country: "France", after: 0 })

    expect(
      await within(figure).findByText(/^German reunification · 3 October 1990 · Germany · /),
    ).toBeDefined()
  })

  it("marks a pension reform on pension spending, and not on unemployment", async () => {
    network.use(resolve, politics)
    const user = userEvent.setup()

    const pension = show(["FRA"], { overlays: ["events"], indicator: pensions })

    const figure = await screen.findByRole("figure")

    await hover(user, { figure, country: "France", after: 0 })

    expect(
      await within(figure).findByText(
        "Woerth reform · Adopted 9 November 2010 · The minimum pension age rose from 60 to 62 by four months per birth cohort. · Source 1 below",
      ),
    ).toBeDefined()

    pension.unmount()
    show(["FRA"], { overlays: ["events"] })

    const other = await screen.findByRole("figure")

    await hover(user, { figure: other, country: "France", after: 0 })

    // The tooltip names France beside its legend, and no reform.
    await vi.waitFor(() => expect(within(other).getAllByText("France").length).toBeGreaterThan(1))
    expect(within(other).queryByText(/Woerth reform/)).toBeNull()
    expect(within(other).queryByText(/with reforms marked/)).toBeNull()
  })
})
