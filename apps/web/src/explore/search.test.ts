import { transformOf } from "@openfacts/domain"
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
  it("opens deployed share ids unchanged and preserves a fourth publisher", () => {
    for (const indicator of [
      "SP.POP.TOTL",
      "ESTAT,UNE_RT_A,1.0",
      "OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0",
      "Fixture:SP.POP.TOTL",
    ]) {
      const search: Search = { ...trend, indicator }
      const view = toView(search)
      const reopened = fromUrl(new URL(`https://example.org/explore${toQuery(view)}`))
      expect(reopened).toEqual(view)
      expect(toSearch(view).indicator).toBe(indicator)
    }
  })

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

  it("round-trips a ranking drawn as a map", () => {
    const map: Search = {
      chart: "ranking",
      indicator: "SP.POP.TOTL",
      countries: "FRA,DEU",
      year: 2020,
      as: "map",
    }

    expect(toSearch(toView(map))).toEqual(map)
  })

  it("round-trips a map over time, and refuses a year outside its span or one end alone", () => {
    const oneEnd: Search = {
      chart: "ranking",
      indicator: "SP.DYN.LE00.IN",
      countries: "NGA,KEN",
      year: 2000,
      to: 2022,
      as: "map",
    }

    const map: Search = { ...oneEnd, from: 1990 }

    expect(toSearch(toView(map))).toEqual(map)
    expect(() => toView({ ...map, year: 1980 })).toThrow("Schema validation failed")
    expect(() => toView(oneEnd)).toThrow("from goes with to")
  })

  it("round-trips a ratio with the indicator it divides by", () => {
    const ratio: Search = { ...trend, transform: "ratio", per: "NY.GDP.MKTP.CD" }

    expect(toSearch(toView(ratio))).toEqual(ratio)
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

  it("round-trips the series an SDMX indicator picks", () => {
    const unemployment: Search = {
      ...trend,
      indicator: "ESTAT,UNE_RT_A,1.0",
      dimensions: "sex:T,age:Y15-74",
    }

    expect(toSearch(toView(unemployment))).toEqual(unemployment)
    expect(toView(unemployment).dimensions).toEqual({ sex: "T", age: "Y15-74" })
  })

  it("reads a View back from the query string it writes", () => {
    const view = toView({ ...trend, transform: "per-person" })

    expect(toQuery(view)).toBe(
      "?chart=trend&indicator=SP.POP.TOTL&countries=FRA%2CDEU&from=2000&to=2022&transform=per-person",
    )
    expect(fromUrl(new URL(`https://openfacts.example/explore.png${toQuery(view)}`))).toEqual(view)
  })

  it.each([
    ["years that run backwards", { ...trend, from: 2022, to: 2000 }],
    ["an unknown country", { ...trend, countries: "FRA,XXX" }],
    ["an aggregate instead of a country", { ...trend, countries: "EUU" }],
    ["a repeated country", { ...trend, countries: "FRA,FRA" }],
    ["no country", { ...trend, countries: "" }],
    ["a year before 1960", { ...trend, from: 1950 }],
    ["a ratio without the indicator it divides by", { ...trend, transform: "ratio" as const }],
    ["an indicator to divide by without a ratio", { ...trend, per: "NY.GDP.MKTP.CD" }],
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
    ["a dimension the chart sets itself", { ...trend, dimensions: "geo:FR" }],
    ["a dimension without a value", { ...trend, dimensions: "sex" }],
  ])("rejects %s", (_, search) => {
    expect(() => toView(search)).toThrow(Error)
  })
})
