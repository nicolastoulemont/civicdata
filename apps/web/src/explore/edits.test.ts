import { IndicatorId, Ranking, Trend, Year } from "@civicdata/domain"
import { describe, expect, it } from "vitest"

import { asRanking, asTrend, withIndicator } from "./edits.ts"

const population = IndicatorId.make("SP.POP.TOTL")

describe("chart type edits", () => {
  it("ranks a trend's last year", () => {
    const trend = Trend.make({
      indicator: population,
      countries: ["FRA", "DEU"],
      from: Year.make(2000),
      to: Year.make(2022),
    })

    expect(asRanking(trend)).toEqual(
      Ranking.make({ indicator: population, countries: ["FRA", "DEU"], year: Year.make(2022) }),
    )
  })

  it("turns a ranking into the twenty years leading to it", () => {
    const ranking = Ranking.make({
      indicator: population,
      countries: ["FRA"],
      year: Year.make(2022),
    })

    expect(asTrend(ranking)).toEqual(
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

    expect(asTrend(ranking)).toMatchObject({ from: 1960, to: 1970 })
  })

  it("drops an index when a trend becomes a ranking, and keeps growth", () => {
    const base = {
      indicator: population,
      countries: ["FRA"] as const,
      from: Year.make(2000),
      to: Year.make(2022),
    }

    expect(asRanking(Trend.make({ ...base, transform: "Index" })).transform).toBeUndefined()
    expect(asRanking(Trend.make({ ...base, transform: "Growth" })).transform).toBe("Growth")
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
    expect(switched.transform).toBeUndefined()
  })

  it("keeps a transform the new indicator takes", () => {
    expect(withIndicator(perPerson, { id: population, name: "Population, total" }).transform).toBe(
      "PerPerson",
    )
  })
})
