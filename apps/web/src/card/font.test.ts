import { describe, expect, it } from "vitest"

import { label } from "./faces.gen.ts"
import { fit, measure, wrap } from "./font.ts"

describe("font", () => {
  it("cuts text wider than the space with an ellipsis", () => {
    expect(fit(label, "Germany", 200)).toBe("Germany")

    const cut = fit(label, "Micronesia, Fed. Sts.", 80)

    expect(cut.endsWith("…")).toBe(true)
    expect(measure(label, cut)).toBeLessThanOrEqual(80)
  })

  it("wraps at spaces and cuts the last line", () => {
    const name = "Mortality rate attributed to household and ambient air pollution"
    const [first = "", last = ""] = wrap(label, name, { width: 120, lines: 2 })

    expect(name.startsWith(`${first} `)).toBe(true)
    expect(last.endsWith("…")).toBe(true)
    expect(Math.max(measure(label, first), measure(label, last))).toBeLessThanOrEqual(120)
  })
})
