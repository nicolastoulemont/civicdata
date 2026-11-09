import { describe, expect, it } from "vitest"

import { fill, slot } from "./palette.ts"

describe("country colors", () => {
  it("assigns six hues by position, then keeps overflow countries gray", () => {
    expect(Array.from({ length: 8 }, (_, index) => fill(slot(index)))).toEqual([
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--chart-3)",
      "var(--chart-4)",
      "var(--chart-5)",
      "var(--chart-6)",
      "var(--chart-other)",
      "var(--chart-other)",
    ])
  })
})
