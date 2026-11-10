import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

import { IndicatorId } from "../src/Indicator.ts"
import { Ranking, View, Year } from "../src/View.ts"

const decode = Schema.decodeUnknownEffect(View)

// A ranking as links and conversations stored it before spans: one year.
const stored = Schema.encodeSync(View)(
  Ranking.make({
    indicator: IndicatorId.make("SP.DYN.LE00.IN"),
    countries: ["FRA", "DEU"],
    year: Year.make(2020),
  }),
)

describe("Ranking", () => {
  it.effect("decodes a ranking stored without a span, as a static chart", () =>
    Effect.gen(function* () {
      const view = yield* decode(stored)

      expect(view).toEqual(stored)
    }),
  )

  it.effect("decodes a ranking over a span holding its year", () =>
    Effect.gen(function* () {
      const view = yield* decode({ ...stored, span: { from: 1990, to: 2022 } })

      expect(view).toEqual({ ...stored, span: { from: 1990, to: 2022 } })
    }),
  )

  it.effect("rejects a year outside the span", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(decode({ ...stored, span: { from: 2000, to: 2010 } }))

      expect(error.message).toContain("year must lie inside span")
    }),
  )

  it.effect("rejects a span that runs backwards", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decode({ ...stored, year: 2000, span: { from: 2010, to: 1990 } }),
      )

      expect(error.message).toContain("from must not be after to")
    }),
  )
})
