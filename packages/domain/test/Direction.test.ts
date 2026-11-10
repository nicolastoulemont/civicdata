import { describe, expect, it } from "@effect/vitest"

import { directionAfter } from "../src/Direction.ts"
import { IndicatorId } from "../src/Indicator.ts"
import { Ratio, type Transform } from "../src/Transform.ts"

const ratio = Ratio.make({ per: IndicatorId.make("NY.GDP.MKTP.CD") })

describe("directionAfter", () => {
  it.each(["Higher", "Lower", "Neutral"] as const)(
    "keeps %s as published, per person, as growth and as an index",
    (direction) => {
      const kept: ReadonlyArray<Transform | undefined> = [undefined, "PerPerson", "Growth", "Index"]

      expect(kept.map((transform) => directionAfter(direction, transform))).toEqual([
        direction,
        direction,
        direction,
        direction,
      ])
    },
  )

  it.each(["Higher", "Lower", "Neutral"] as const)("makes a ratio of %s neutral", (direction) => {
    expect(directionAfter(direction, ratio)).toBe("Neutral")
  })
})
