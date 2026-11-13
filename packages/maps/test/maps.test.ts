import { describe, expect, it } from "vitest"

import { countryMaps } from "../scripts/countries.ts"
import { load } from "../src/index.ts"
import { countries } from "./countries.ts"

describe("country maps", () => {
  it("covers every registered country with a data contract", () => {
    expect(countries.map(([code]) => code).toSorted()).toEqual(
      countryMaps.map((map) => map.country).toSorted(),
    )
  })

  it.each(countries)(
    "keeps the published subdivisions of %s",
    async (country, count, main, away) => {
      const sheet = await load([country])

      const areas = [
        ...(sheet.subdivisions?.areas ?? []),
        ...sheet.insets.flatMap((inset) => inset.areas ?? []),
      ]

      expect(sheet.subdivisions?.country).toBe(country)
      expect(areas).toHaveLength(count)
      expect(areas.map((area) => area.name)).toContain(main)
      expect(areas.map((area) => area.name)).toContain(away)
    },
  )

  it("reuses the same loading promise for a country", () => {
    expect(load(["FRA"])).toBe(load(["FRA"]))
  })

  it("keeps unsupported countries on their comparison map", async () => {
    const sheet = await load(["ABW"])

    expect(sheet.subdivisions).toBeUndefined()
    expect(sheet.outlines.ABW?.length).toBeGreaterThan(0)
  })

  it("keeps comparisons on the shared geographic frame", async () => {
    const sheet = await load(["FRA", "USA"])

    expect(sheet.subdivisions).toBeUndefined()
    expect(sheet.outlines.FRA?.length).toBeGreaterThan(0)
    expect(sheet.outlines.USA?.length).toBeGreaterThan(0)
  })
})
