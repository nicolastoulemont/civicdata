import { describe, expect, it } from "vitest"

import { atEnd, followScroll } from "./scroll.ts"

describe("scroll geometry", () => {
  it("treats short content and rounded end positions as the end", () => {
    expect(atEnd({ top: 0, height: 600, content: 200 })).toBe(true)
    expect(atEnd({ top: 396.5, height: 600, content: 1000 })).toBe(true)
    expect(atEnd({ top: 300, height: 600, content: 1000 })).toBe(false)
  })

  it("keeps following when new content grows below the viewport", () => {
    expect(followScroll("following", { top: 400, previous: 400, height: 600, content: 1200 })).toBe(
      "following",
    )
  })

  it("stops on a move toward older rows", () => {
    expect(followScroll("following", { top: 380, previous: 400, height: 600, content: 1000 })).toBe(
      "stopped",
    )
  })

  it("stays stopped through growth and resumes only on reaching the end", () => {
    expect(followScroll("stopped", { top: 200, previous: 200, height: 600, content: 1200 })).toBe(
      "stopped",
    )
    expect(followScroll("stopped", { top: 400, previous: 200, height: 600, content: 1200 })).toBe(
      "stopped",
    )
    expect(followScroll("stopped", { top: 600, previous: 400, height: 600, content: 1200 })).toBe(
      "following",
    )
  })
})
