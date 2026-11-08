import { describe, expect, it } from "vitest"

import { type Search, toSearch, toView } from "./search.ts"

const trend: Search = {
  chart: "trend",
  indicator: "SP.POP.TOTL",
  countries: "FRA,DEU",
  from: 2000,
  to: 2022,
}

describe("explore URL", () => {
  it("round-trips a trend and a ranking", () => {
    const ranking: Search = {
      chart: "ranking",
      indicator: "NY.GDP.PCAP.CD",
      countries: "USA,JPN",
      year: 2023,
    }

    expect(toSearch(toView(trend))).toEqual(trend)
    expect(toSearch(toView(ranking))).toEqual(ranking)
  })

  it.each([
    ["years that run backwards", { ...trend, from: 2022, to: 2000 }],
    ["an unknown country", { ...trend, countries: "FRA,XXX" }],
    ["an aggregate instead of a country", { ...trend, countries: "EUU" }],
    ["a repeated country", { ...trend, countries: "FRA,FRA" }],
    ["no country", { ...trend, countries: "" }],
    ["a year before 1960", { ...trend, from: 1950 }],
  ])("rejects %s", (_, search) => {
    expect(() => toView(search)).toThrow(Error)
  })
})
