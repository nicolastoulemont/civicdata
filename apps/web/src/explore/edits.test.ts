import {
  Change,
  Dimensions,
  IndicatorId,
  Ranking,
  Ratio,
  Relation,
  transformOf,
  Trend,
  Year,
} from "@repo/domain"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import { withAgainst, withChart, withIndicator, withTransform } from "./edits.ts"

const population = IndicatorId.make("SP.POP.TOTL")

describe("chart type edits", () => {
  it("ranks a trend's last year", () => {
    const trend = Trend.make({
      indicator: population,
      countries: ["FRA", "DEU"],
      from: Year.make(2000),
      to: Year.make(2022),
    })

    expect(withChart(trend, "Ranking")).toEqual(
      Ranking.make({ indicator: population, countries: ["FRA", "DEU"], year: Year.make(2022) }),
    )
  })

  it("turns a ranking into the twenty years leading to it", () => {
    const ranking = Ranking.make({
      indicator: population,
      countries: ["FRA"],
      year: Year.make(2022),
    })

    expect(withChart(ranking, "Trend")).toEqual(
      Trend.make({
        indicator: population,
        countries: ["FRA"],
        from: Year.make(2002),
        to: Year.make(2022),
      }),
    )
  })

  it("starts such a trend no earlier than 1960", () => {
    const ranking = Ranking.make({
      indicator: population,
      countries: ["FRA"],
      year: Year.make(1970),
    })

    expect(withChart(ranking, "Trend")).toMatchObject({ from: 1960, to: 1970 })
  })

  it("drops an index when a trend becomes a ranking, and keeps growth", () => {
    const base = {
      indicator: population,
      countries: ["FRA"] as const,
      from: Year.make(2000),
      to: Year.make(2022),
    }

    const ranked = (transform: "Index" | "Growth") =>
      transformOf(withChart(Trend.make({ ...base, transform }), "Ranking"))

    expect(ranked("Index")).toBeUndefined()
    expect(ranked("Growth")).toBe("Growth")
  })

  it("compares a trend's first and last years, keeping only a per-person transform", () => {
    const base = {
      indicator: population,
      countries: ["FRA"] as const,
      from: Year.make(2000),
      to: Year.make(2022),
    }

    expect(withChart(Trend.make({ ...base, transform: "PerPerson" }), "Change")).toEqual(
      Change.make({ ...base, transform: "PerPerson" }),
    )
    expect(withChart(Trend.make({ ...base, transform: "Growth" }), "Change")).toEqual(
      Change.make(base),
    )
  })

  it("draws a trend's last year as a map, keeping it a map when its transform changes", () => {
    const trend = Trend.make({
      indicator: population,
      countries: ["FRA"],
      from: Year.make(2000),
      to: Year.make(2022),
    })

    const map = withChart(trend, "Map")

    expect(map).toEqual(
      Ranking.make({ indicator: population, countries: ["FRA"], year: Year.make(2022), as: "Map" }),
    )
    expect(withTransform(map, "PerPerson")).toMatchObject({ as: "Map", transform: "PerPerson" })
    expect(withChart(map, "Ranking")).not.toHaveProperty("as")
  })

  it("plots a chart's last year against GDP per person", () => {
    const trend = Trend.make({
      indicator: population,
      countries: ["FRA"],
      from: Year.make(2000),
      to: Year.make(2022),
      transform: "Index",
    })

    expect(withChart(trend, "Relation")).toEqual(
      Relation.make({
        indicator: population,
        against: IndicatorId.make("NY.GDP.PCAP.CD"),
        countries: ["FRA"],
        year: Year.make(2022),
      }),
    )
  })
})

describe("ratio edits", () => {
  const gdp = IndicatorId.make("NY.GDP.MKTP.CD")

  it("drops a ratio when the chart's indicator becomes the one it divides by", () => {
    const ratio = Trend.make({
      indicator: population,
      countries: ["FRA"],
      from: Year.make(2000),
      to: Year.make(2022),
      transform: Ratio.make({ per: gdp }),
    })

    expect(
      transformOf(withIndicator(ratio, { id: gdp, name: "GDP (current US$)" })),
    ).toBeUndefined()
  })

  it("keeps a ratio when a trend becomes a change", () => {
    const ratio = Trend.make({
      indicator: population,
      countries: ["FRA"],
      from: Year.make(2000),
      to: Year.make(2022),
      transform: Ratio.make({ per: gdp }),
    })

    expect(transformOf(withChart(ratio, "Change"))).toEqual(Ratio.make({ per: gdp }))
  })
})

describe("indicator edits", () => {
  const perPerson = Trend.make({
    indicator: IndicatorId.make("NY.GDP.MKTP.CD"),
    countries: ["FRA"],
    from: Year.make(2000),
    to: Year.make(2022),
    transform: "PerPerson",
  })

  it("drops a transform the new indicator cannot take", () => {
    const switched = withIndicator(perPerson, {
      id: IndicatorId.make("SL.UEM.TOTL.ZS"),
      name: "Unemployment, total (% of total labor force)",
    })

    expect(switched.indicator).toBe("SL.UEM.TOTL.ZS")
    expect(transformOf(switched)).toBeUndefined()
  })

  it("keeps a transform the new indicator takes", () => {
    expect(
      transformOf(withIndicator(perPerson, { id: population, name: "Population, total" })),
    ).toBe("PerPerson")
  })

  const relation = Relation.make({
    indicator: IndicatorId.make("SP.DYN.LE00.IN"),
    against: IndicatorId.make("NY.GDP.PCAP.CD"),
    countries: ["FRA"],
    year: Year.make(2022),
  })

  it("swaps a relation's axes when given the indicator it is plotted against", () => {
    const swapped = { ...relation, indicator: relation.against, against: relation.indicator }

    expect(withIndicator(relation, { id: relation.against, name: "GDP per capita" })).toEqual(
      swapped,
    )
    expect(withAgainst(relation, { id: relation.indicator, name: "Life expectancy" })).toEqual(
      swapped,
    )
  })
})

describe("dimension edits", () => {
  const unemployment = Trend.make({
    indicator: IndicatorId.make("ESTAT,UNE_RT_A,1.0"),
    countries: ["FRA"],
    from: Year.make(2000),
    to: Year.make(2022),
    dimensions: Schema.decodeSync(Dimensions)({ sex: "T", age: "Y15-74", unit: "PC_ACT" }),
  })

  it("keeps the series a View picks when its chart type or transform changes", () => {
    for (const chart of ["Ranking", "Map", "Change", "Relation"] as const)
      expect(withChart(unemployment, chart).dimensions).toEqual(unemployment.dimensions)

    expect(withChart(withChart(unemployment, "Ranking"), "Trend").dimensions).toEqual(
      unemployment.dimensions,
    )
    expect(withTransform(unemployment, "Growth").dimensions).toEqual(unemployment.dimensions)
  })

  it("drops them when the indicator changes, since they were the old one's", () => {
    expect(withIndicator(unemployment, { id: population, name: "Population, total" })).toEqual(
      Trend.make({
        indicator: population,
        countries: ["FRA"],
        from: Year.make(2000),
        to: Year.make(2022),
      }),
    )
  })
})
