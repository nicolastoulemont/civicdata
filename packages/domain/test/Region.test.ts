import { describe, expect, it } from "vitest"

import type { Country } from "../src/Country.ts"
import { regions } from "../src/Region.ts"

// Every region by its countries, whatever its own list's type.
const listed: ReadonlyArray<{ readonly id: string; readonly countries: ReadonlyArray<Country> }> =
  regions

describe("regions", () => {
  it("lists each country of a region once", () => {
    const repeated = listed.flatMap(({ id, countries }) =>
      countries
        .filter((country, place) => countries.indexOf(country) !== place)
        .map((country) => `${id}: ${country}`),
    )

    expect(repeated).toEqual([])
  })
})
