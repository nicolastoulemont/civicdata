import { describe, expect, it } from "@effect/vitest"

import { fits } from "../src/Titles.ts"

const name = "GDP per capita, PPP (constant 2021 international $)"

describe("fits", () => {
  it("accepts a rewording that keeps the name's numbers", () => {
    expect(fits("GDP per person (constant 2021 $, adjusted for living costs)", name)).toBe(true)
  })

  it("rejects a number the name lacks", () => {
    expect(fits("GDP per person (constant 2017 $)", name)).toBe(false)
  })

  it("rejects characters the link-preview card cannot draw", () => {
    expect(fits("GDP per person — today’s prices", name)).toBe(false)
  })

  it("rejects an empty or long title", () => {
    expect(fits("", name)).toBe(false)
    expect(fits("GDP per person ".repeat(6), name)).toBe(false)
  })
})
