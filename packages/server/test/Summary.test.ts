import {
  Change,
  IndicatorId,
  Ranking,
  Relation as RelationView,
  type ResolvedView,
  Trend,
  Year,
} from "@civicdata/domain"
import { DateTime } from "effect"
import { describe, expect, it } from "vitest"

import { summarize } from "../src/Summary.ts"

const youthUnemployment = IndicatorId.make("SL.UEM.1524.ZS")

// Youth unemployment in Spain and Italy, unless a test passes other data.
const resolved = (
  view: Trend | typeof Ranking.Type,
  {
    indicator = {
      id: youthUnemployment,
      name: "Unemployment, youth total (% of total labor force ages 15-24)",
      definition: "",
    },
    observations = [
      { country: "ESP", year: Year.make(2010), value: 41.53 },
      { country: "ESP", year: Year.make(2013), value: 55.48 },
      { country: "ESP", year: Year.make(2024), value: 26.47 },
      { country: "ITA", year: Year.make(2010), value: 27.9 },
      { country: "ITA", year: Year.make(2024), value: 20.31 },
    ],
  }: Partial<Pick<ResolvedView, "indicator" | "observations">> = {},
): ResolvedView => ({
  view,
  title: indicator.name,
  indicator,
  observations,
  missing: [],
  dimensions: [],
  disagreements: [],
  sources: [
    {
      indicator: indicator.id,
      name: indicator.name,
      source: "World Bank",
      dataset: "World Development Indicators",
      url: "https://api.worldbank.org/v2/indicator/SL.UEM.1524.ZS",
      retrievedAt: DateTime.makeUnsafe("2026-11-01T00:00:00Z"),
    },
  ],
})

// Spain and Italy, 2010 to 2024: Spain peaks at 55.48 in 2013.
const trend = summarize(
  resolved(
    Trend.make({
      indicator: youthUnemployment,
      countries: ["ESP", "ITA"],
      from: Year.make(2010),
      to: Year.make(2024),
    }),
  ),
)

describe("summarize", () => {
  it("gives each line's first, last, lowest and highest point", () => {
    expect(trend).toMatchObject({
      from: 2010,
      to: 2024,
      lines: [
        {
          country: "ESP",
          first: { year: 2010, value: 41.53 },
          last: { year: 2024, value: 26.47 },
          lowest: { year: 2024, value: 26.47 },
          highest: { year: 2013, value: 55.48 },
        },
        {
          country: "ITA",
          first: { year: 2010, value: 27.9 },
          last: { year: 2024, value: 20.31 },
        },
      ],
    })
  })

  it("orders a ranking's bars from highest to lowest", () => {
    const ranking = summarize(
      resolved(
        Ranking.make({
          indicator: youthUnemployment,
          countries: ["ESP", "ITA"],
          year: Year.make(2024),
        }),
      ),
    )

    expect(ranking).toMatchObject({
      year: 2024,
      bars: [55.48, 41.53, 27.9, 26.47, 20.31].map((value) => ({ value })),
    })
  })
})

describe("summarize how the source qualifies the values", () => {
  // Ireland's GDP growth as Eurostat flags it: a break in series in 2015,
  // and a provisional, estimated latest year.
  const observations = [
    { country: "IRL", year: Year.make(2014), value: 9.4 },
    { country: "IRL", year: Year.make(2015), value: 25.2, flags: ["Break"] },
    { country: "IRL", year: Year.make(2016), value: 2.1 },
    {
      country: "IRL",
      year: Year.make(2024),
      value: 1.2,
      flags: ["Provisional", "Estimated"],
    },
  ] as const

  it("names each break in series a trend crosses, by country and year", () => {
    const summary = summarize(
      resolved(
        Trend.make({
          indicator: youthUnemployment,
          countries: ["IRL"],
          from: Year.make(2014),
          to: Year.make(2024),
        }),
        { observations },
      ),
    )

    expect(summary.flagged).toEqual({
      breaks: [{ country: "IRL", year: 2015 }],
      provisional: 1,
      estimated: 1,
    })
  })

  it("names a break between the two years of a change, which the chart drops", () => {
    const years = {
      indicator: youthUnemployment,
      countries: ["IRL"],
      from: Year.make(2014),
      to: Year.make(2016),
    } as const

    const summary = summarize({
      ...resolved(Trend.make(years), {
        observations: observations.filter(({ year }) => year === 2014 || year === 2016),
      }),
      view: Change.make(years),
      breaks: [{ country: "IRL", year: Year.make(2015) }],
    })

    expect(summary.flagged).toEqual({
      breaks: [{ country: "IRL", year: 2015 }],
      provisional: 0,
      estimated: 0,
    })
  })
})

describe("summarize a relation", () => {
  const gdpPerPerson = IndicatorId.make("NY.GDP.PCAP.CD")

  // Youth unemployment against GDP per person in 2024.
  const relation = summarize({
    ...resolved(
      Ranking.make({
        indicator: youthUnemployment,
        countries: ["ESP", "ITA"],
        year: Year.make(2024),
      }),
      {
        observations: [
          { country: "ESP", year: Year.make(2024), value: 26.47 },
          { country: "ITA", year: Year.make(2024), value: 20.31 },
        ],
      },
    ),
    view: RelationView.make({
      indicator: youthUnemployment,
      against: gdpPerPerson,
      countries: ["ESP", "ITA"],
      year: Year.make(2024),
    }),
    against: {
      title: "GDP per person",
      indicator: { id: gdpPerPerson, name: "GDP per capita (current US$)", definition: "" },
      observations: [
        { country: "ESP", year: Year.make(2024), value: 35_327 },
        { country: "ITA", year: Year.make(2024), value: 40_226 },
      ],
    },
  })

  it("pairs each country's values", () => {
    expect(relation).toMatchObject({
      against: "GDP per capita (current US$)",
      year: 2024,
      dots: [
        { country: "ESP", value: 26.47, against: 35_327 },
        { country: "ITA", value: 20.31, against: 40_226 },
      ],
    })
  })
})
