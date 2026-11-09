import {
  IndicatorId,
  Ranking,
  type Relation,
  Relation as RelationView,
  type ResolvedView,
  Trend,
  Year,
} from "@civicdata/domain"
import { DateTime, Option } from "effect"
import { describe, expect, it } from "vitest"

import { check, summarize } from "../src/Takeaway.ts"

const youthUnemployment = IndicatorId.make("SL.UEM.1524.ZS")

// Youth unemployment in Spain and Italy, unless a test passes other data.
const resolved = (
  view: Exclude<ResolvedView["view"], Relation>,
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

const shows = (text: string) => Option.isSome(check(text, trend))

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

  it("lets a takeaway cite either value", () => {
    expect(
      Option.isSome(check("Spain, at $35,327 a person, had 26.5% youth unemployment.", relation)),
    ).toBe(true)
    expect(Option.isSome(check("Italy was $4,899 richer per person.", relation))).toBe(false)
  })
})

describe("check", () => {
  it("shows a takeaway whose numbers are values and years from the data, rounded", () => {
    expect(
      check("  Youth unemployment in Spain peaked at 55.5% in 2013, then fell to 26.  ", trend),
    ).toEqual(Option.some("Youth unemployment in Spain peaked at 55.5% in 2013, then fell to 26."))
    expect(shows("Italy's rate went from 27.9% to 20.3% between 2010 and 2024.")).toBe(true)
  })

  it("hides a takeaway with a number the data does not have", () => {
    expect(shows("Spain peaked at 56% in 2013.")).toBe(false)
    expect(shows("Spain peaked at 55.48% in 2012.")).toBe(false)
  })

  it("hides a takeaway with a number the model worked out", () => {
    // 55.48 - 26.47
    expect(shows("Spain's rate fell by 29 points after 2013.")).toBe(false)
  })

  it("accepts numbers in the indicator's name and ignores digits inside words", () => {
    expect(shows("Among people aged 15-24, Spain stayed above Italy.")).toBe(true)
    expect(shows("Spain had the highest youth unemployment of the G7 and the EU27.")).toBe(true)
  })

  it("removes Markdown bold, which the answer would show as asterisks", () => {
    expect(check("**Spain** peaked in 2013.", trend)).toEqual(Option.some("Spain peaked in 2013."))
  })

  it("hides an empty takeaway", () => {
    expect(check("   ", trend)).toEqual(Option.none())
  })
})

describe("check with scaled numbers", () => {
  const gdp = summarize(
    resolved(
      Ranking.make({
        indicator: IndicatorId.make("NY.GDP.MKTP.CD"),
        countries: ["IND"],
        year: Year.make(2023),
      }),
      {
        indicator: {
          id: IndicatorId.make("NY.GDP.MKTP.CD"),
          name: "GDP (current US$)",
          definition: "",
        },
        observations: [{ country: "IND", year: Year.make(2023), value: 3_567_551_674_623 }],
      },
    ),
  )

  it("reads thousands separators and scale words", () => {
    expect(Option.isSome(check("India's economy reached $3.6 trillion.", gdp))).toBe(true)
    expect(Option.isSome(check("India's economy reached $3,568 billion.", gdp))).toBe(true)
    expect(Option.isSome(check("India's economy reached $3.5 trillion.", gdp))).toBe(false)
  })
})
