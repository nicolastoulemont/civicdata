import { Dimensions, IndicatorId, Ranking, Trend, Year } from "@civicdata/domain"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import { counterparts, disagreeing } from "../src/Counterparts.ts"

const unemployment = Trend.make({
  indicator: IndicatorId.make("SL.UEM.TOTL.ZS"),
  countries: ["FRA"],
  from: Year.make(2020),
  to: Year.make(2024),
})

// Eurostat's unemployment rate for everyone aged 15 to 74 of one sex, or "T" for all.
const eurostat = (sex: string) =>
  Ranking.make({
    indicator: IndicatorId.make("ESTAT,UNE_RT_A,1.0"),
    countries: ["FRA"],
    year: Year.make(2024),
    dimensions: Schema.decodeSync(Dimensions)({ age: "Y15-74", unit: "PC_ACT", sex }),
  })

describe("counterparts", () => {
  it("finds the other sources' series for the same figure", () => {
    expect(counterparts(unemployment).map(({ indicator }) => indicator)).toEqual([
      "ESTAT,UNE_RT_A,1.0",
      "OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0",
    ])
  })

  it("matches an SDMX series only on the dimensions its group names", () => {
    expect(counterparts(eurostat("T")).map(({ indicator }) => indicator)).toContain(
      "SL.UEM.TOTL.ZS",
    )
    expect(counterparts(eurostat("F"))).toEqual([])
  })

  it("has none for a transformed value", () => {
    expect(counterparts(Trend.make({ ...unemployment, transform: "Index" }))).toEqual([])
  })
})

describe("disagreeing", () => {
  const year = Year.make(2024)

  it("keeps the other source's values more than 1% away from the chart's", () => {
    expect(
      disagreeing(
        [
          { country: "FRA", year, value: 7.4 },
          { country: "DEU", year, value: 100 },
        ],
        [
          { country: "FRA", year, value: 7.3 },
          { country: "DEU", year, value: 100.5 },
          { country: "ITA", year, value: 6 },
        ],
      ),
    ).toEqual([{ country: "FRA", year, value: 7.3 }])
  })
})
