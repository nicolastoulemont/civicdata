import { IndicatorId } from "@repo/domain"
import { DateTime } from "effect"
import { expect, it } from "vitest"

import { page } from "./format.ts"

it("links new publishers to their fetched provenance and keeps deployed landing pages", () => {
  const provenance = {
    indicator: IndicatorId.make("Fixture:measure"),
    name: "Annual measure",
    source: "Fixture",
    dataset: "Test release",
    url: "https://example.org/release/measure",
    retrievedAt: DateTime.makeUnsafe("2026-11-11T00:00:00Z"),
  }

  expect(page(provenance)).toBe(provenance.url)
  expect(
    page({ ...provenance, source: "World Bank", indicator: IndicatorId.make("SP.POP.TOTL") }),
  ).toBe("https://data.worldbank.org/indicator/SP.POP.TOTL")
  expect(
    page({ ...provenance, source: "Eurostat", indicator: IndicatorId.make("ESTAT,UNE_RT_A,1.0") }),
  ).toBe("https://ec.europa.eu/eurostat/databrowser/view/une_rt_a/default/table")
})
