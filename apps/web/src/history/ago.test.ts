import { DateTime } from "effect"
import { describe, expect, it } from "vitest"

import { ago } from "./ago.ts"

const now = DateTime.makeUnsafe("2026-11-09T12:00:00Z")

const before = (iso: string) => ago(DateTime.makeUnsafe(iso), now)

describe("ago", () => {
  it("says now under a minute, and for a time slightly ahead of the clock", () => {
    expect(before("2026-11-09T11:59:01Z")).toBe("now")
    expect(before("2026-11-09T12:00:30Z")).toBe("now")
  })

  it("counts whole minutes, then hours, then days", () => {
    expect(before("2026-11-09T11:58:59Z")).toBe("1m")
    expect(before("2026-11-09T11:00:01Z")).toBe("59m")
    expect(before("2026-11-09T11:00:00Z")).toBe("1h")
    expect(before("2026-11-08T12:00:01Z")).toBe("23h")
    expect(before("2026-10-10T12:00:00Z")).toBe("30d")
  })
})
