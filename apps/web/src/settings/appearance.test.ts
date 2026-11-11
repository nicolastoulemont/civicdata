import { afterEach, describe, expect, it, vi } from "vitest"

import { pin, script } from "./appearance.ts"

// Where the choice is kept. Its format outlives deploys: changing it resets
// every visitor to System.
const key = "openfacts:appearance"

const boot = () => {
  // oxlint-disable-next-line typescript/no-implied-eval -- runs the text the root route inlines in <head>, as the browser does
  new Function(script)()

  return document.documentElement.getAttribute("data-theme")
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  document.documentElement.removeAttribute("data-theme")
})

describe("pin", () => {
  it.each([
    ['"light"', "light"],
    ['"dark"', "dark"],
  ] as const)("pins %s", (stored, theme) => expect(pin(stored)).toBe(theme))

  // System leaves <html> unpinned, so the stylesheet follows the operating
  // system, live and without JavaScript.
  it.each<{ stored: string | null; case: string }>([
    { stored: '"system"', case: "System" },
    { stored: null, case: "nothing stored" },
    { stored: "dark", case: "a value that is not JSON" },
    { stored: '"sepia"', case: "an unknown choice" },
    { stored: '{"theme":"dark"}', case: "another shape" },
  ])("leaves $case unpinned", ({ stored }) => expect(pin(stored)).toBeUndefined())
})

describe("script", () => {
  it("applies the stored choice to <html>", () => {
    localStorage.setItem(key, '"dark"')

    expect(boot()).toBe("dark")
  })

  it("leaves System and broken values to the stylesheet", () => {
    localStorage.setItem(key, "{")

    expect(boot()).toBeNull()
  })

  it("loads the page when the browser blocks storage", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError")
    })

    expect(boot()).toBeNull()
  })
})
