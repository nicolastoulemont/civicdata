// @vitest-environment node
import { readFileSync } from "node:fs"

import { countries } from "@repo/domain"
import { describe, expect, it } from "vitest"

import { colors } from "./colors.gen.ts"
import { color } from "./palette.ts"

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8")
const [light = "", dark = ""] = css.split("@variant dark")

// The card's OKLCH lightness in a theme's section of styles.css. Neutral
// OKLCH has equal linear RGB channels, each L cubed, so that cube is the
// card's relative luminance.
const card = (section: string) => {
  const lightness = section.match(/ {2,}--card: oklch\(([\d.]+) 0 0\);/)?.[1]

  if (lightness === undefined) throw new Error("Missing --card in styles.css")

  return Number(lightness) ** 3
}

// WCAG relative luminance of a hex colour.
const luminance = (hex: string) => {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255

    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

const contrast = (one: number, other: number) =>
  (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05)

describe("country colours", () => {
  it("gives a country the same colour every time, in both themes", () => {
    expect(color("FRA")).toBe(color("FRA"))
    expect(color("FRA")).toBe(`light-dark(${colors.FRA.light}, ${colors.FRA.dark})`)
  })

  it("gives every country a colour of its own in each theme", () => {
    for (const theme of ["light", "dark"] as const) {
      const all = new Set(countries.map(({ code }) => colors[code][theme]))

      expect(all.size).toBe(countries.length)
    }
  })

  it("keeps 3:1 contrast against the card in light and dark", () => {
    const backgrounds = { light: card(light), dark: card(dark) }

    const faint = countries.flatMap(({ code }) =>
      (["light", "dark"] as const).flatMap((theme) =>
        contrast(luminance(colors[code][theme]), backgrounds[theme]) < 3
          ? [`${code} ${theme}`]
          : [],
      ),
    )

    expect(faint).toEqual([])
  })
})
