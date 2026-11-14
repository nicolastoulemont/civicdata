import { describe, expect, it } from "vitest"

import { locate } from "../src/Country.ts"

const codes = (name: string) => locate(name).map((country) => country.code)

describe("locate", () => {
  it("finds a country by code, World Bank name, or a name people use", () => {
    expect(codes("fra")).toEqual(["FRA"])
    expect(codes("Viet Nam")).toEqual(["VNM"])
    expect(codes("Vietnam")).toEqual(["VNM"])
    expect(codes("the UK")).toEqual(["GBR"])
    expect(codes("Côte d’Ivoire")).toEqual(["CIV"])
    expect(codes("Saint Lucia")).toEqual(["LCA"])
  })

  it("finds every country whose name holds the words, for an ambiguous name", () => {
    expect(codes("Korea")).toEqual(["KOR", "PRK"])
    expect(codes("congo")).toEqual(["COD", "COG"])
  })

  it("finds nothing for a place the World Bank has no data for", () => {
    expect(codes("Atlantis")).toEqual([])
    expect(codes("  ")).toEqual([])
  })
})
