import { IndicatorId, Ranking, Relation, Trend, Year } from "@civicdata/domain"
import { describe, expect, it } from "vitest"

import { preview } from "./preview.ts"

const trend = Trend.make({
  indicator: IndicatorId.make("NY.GDP.MKTP.CD"),
  countries: ["FRA", "DEU"],
  from: Year.make(2000),
  to: Year.make(2022),
})

describe("preview", () => {
  it("names the indicator, years, countries and source", () => {
    expect(preview(trend, new Map([[trend.indicator, "GDP (current US$)"]]))).toEqual({
      title: "GDP (current US$) · 2000–2022",
      description: "Compares France and Germany. Source: World Bank.",
    })
  })

  it("says how a ranking's values are shown and counts countries past three", () => {
    const ranking = Ranking.make({
      indicator: trend.indicator,
      countries: ["FRA", "DEU", "ITA", "ESP", "POL"],
      year: Year.make(2020),
      transform: "PerPerson",
    })

    expect(preview(ranking, new Map([[trend.indicator, "GDP (current US$)"]]))).toEqual({
      title: "GDP (current US$) · 2020",
      description: "Ranks France, Germany, Italy, and 2 more (per person). Source: World Bank.",
    })
  })

  it("names both indicators of a relation, falling back to a code without a name", () => {
    const relation = Relation.make({
      indicator: IndicatorId.make("SP.DYN.LE00.IN"),
      against: trend.indicator,
      countries: ["FRA", "DEU"],
      year: Year.make(2020),
    })

    expect(preview(relation, new Map([[relation.indicator, "Life expectancy"]]))).toEqual({
      title: "Life expectancy against NY.GDP.MKTP.CD · 2020",
      description: "Plots France and Germany. Source: World Bank.",
    })
  })
})
