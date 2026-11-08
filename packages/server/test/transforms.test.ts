import { Year } from "@civicdata/domain"
import { describe, expect, it } from "vitest"

import { growth, indexed, perPerson } from "../src/transforms.ts"

const year = (value: number) => Year.make(value)

describe("transforms", () => {
  it("drops a value with no population for its year", () => {
    expect(
      perPerson(
        [
          { country: "FRA", year: year(2019), value: 100 },
          { country: "FRA", year: year(2020), value: 200 },
        ],
        [{ country: "FRA", year: year(2020), value: 4 }],
      ),
    ).toEqual([{ country: "FRA", year: 2020, value: 50 }])
  })

  it("computes growth only where the previous year has a value", () => {
    expect(
      growth([
        { country: "FRA", year: year(2018), value: 100 },
        { country: "FRA", year: year(2019), value: 110 },
        { country: "FRA", year: year(2021), value: 121 },
      ]),
    ).toEqual([{ country: "FRA", year: 2019, value: expect.closeTo(10, 9) }])
  })

  it("indexes to the base year, dropping a country without it", () => {
    expect(
      indexed(
        [
          { country: "FRA", year: year(2000), value: 50 },
          { country: "FRA", year: year(2001), value: 75 },
          { country: "DEU", year: year(2001), value: 80 },
        ],
        year(2000),
      ),
    ).toEqual([
      { country: "FRA", year: 2000, value: 100 },
      { country: "FRA", year: 2001, value: 150 },
    ])
  })
})
