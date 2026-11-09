import { Duration } from "effect"
import { describe, expect, it } from "vitest"

import { elapsed } from "./elapsed.ts"

describe("elapsed", () => {
  it.each([
    { duration: Duration.millis(400), expected: "0s" },
    { duration: Duration.millis(4_900), expected: "4s" },
    { duration: Duration.seconds(65), expected: "1m 05s" },
    { duration: Duration.minutes(62), expected: "1h 02m" },
  ])("reads $expected", ({ duration, expected }) => {
    expect(elapsed(duration)).toBe(expected)
  })
})
