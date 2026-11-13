import { describe, expect, it } from "@effect/vitest"
import { areas, Politics, sourceOf } from "@repo/domain"
import { Schema } from "effect"

import events from "../src/official/events.json"
import reforms from "../src/official/reforms.json"

const history = Schema.decodeUnknownSync(Politics.fields.events)(events)
const reformed = Schema.decodeUnknownSync(Politics.fields.reforms)(reforms)

describe("events and reforms checked by hand", () => {
  it("cites at least one https source for every record", () => {
    for (const record of [...history, ...reformed]) {
      expect(record.sources.length).toBeGreaterThan(0)
      expect(record.sources.every((source) => source.url.startsWith("https://"))).toBe(true)
    }
  })

  it("names each record once", () => {
    const ids = [...history, ...reformed].map((record) => record.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it("maps every reform's policy area to at least one Eurostat or OECD indicator", () => {
    for (const reform of reformed) {
      const indicators = [...areas[reform.area]]

      expect(indicators.length).toBeGreaterThan(0)
      expect(indicators.every((indicator) => sourceOf(indicator) !== "World Bank")).toBe(true)
    }
  })
})
