import { transformOf } from "@civicdata/domain"
import { describe, expect, it } from "vitest"

import { fromUrl, type Search, toQuery, toSearch, toView } from "./search.ts"

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

  it("round-trips a change and a relation", () => {
    const change: Search = { ...trend, chart: "change", transform: "per-person" }

    const relation: Search = {
      chart: "relation",
      indicator: "SP.DYN.LE00.IN",
      against: "NY.GDP.PCAP.CD",
      countries: "USA,JPN",
      year: 2023,
    }

    expect(toSearch(toView(change))).toEqual(change)
    expect(toSearch(toView(relation))).toEqual(relation)
  })

  it("round-trips a transform", () => {
    const indexed: Search = { ...trend, transform: "index" }

    expect(toSearch(toView(indexed))).toEqual(indexed)
    expect(transformOf(toView(indexed))).toBe("Index")
  })

  it("reads a View back from the query string it writes", () => {
    const view = toView({ ...trend, transform: "per-person" })

    expect(toQuery(view)).toBe(
      "?chart=trend&indicator=SP.POP.TOTL&countries=FRA%2CDEU&from=2000&to=2022&transform=per-person",
    )
    expect(fromUrl(new URL(`https://civicdata.example/explore.png${toQuery(view)}`))).toEqual(view)
  })

  it.each([
    ["years that run backwards", { ...trend, from: 2022, to: 2000 }],
    ["an unknown country", { ...trend, countries: "FRA,XXX" }],
    ["an aggregate instead of a country", { ...trend, countries: "EUU" }],
    ["a repeated country", { ...trend, countries: "FRA,FRA" }],
    ["no country", { ...trend, countries: "" }],
    ["a year before 1960", { ...trend, from: 1950 }],
    [
      "a relation of an indicator to itself",
      {
        chart: "relation" as const,
        indicator: "SP.POP.TOTL",
        against: "SP.POP.TOTL",
        countries: "FRA",
        year: 2020,
      },
    ],
  ])("rejects %s", (_, search) => {
    expect(() => toView(search)).toThrow(Error)
  })
})
