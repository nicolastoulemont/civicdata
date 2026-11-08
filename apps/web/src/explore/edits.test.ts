import { IndicatorId, Ranking, Trend, Year } from "@civicdata/domain"
import { describe, expect, it } from "vitest"

import { asRanking, asTrend } from "./edits.ts"

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
})
