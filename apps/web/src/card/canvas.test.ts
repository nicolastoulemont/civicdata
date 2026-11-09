// @vitest-environment node
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { canvas, type Ink, png, rect } from "./canvas.ts"

const css =
  readFileSync(new URL("../styles.css", import.meta.url), "utf8").split("@variant dark")[0] ?? ""

const token = (name: string) => {
  const value = css.match(new RegExp(`  --${name}: ([^;]+);`))?.[1]

  if (value === undefined) throw new Error(`Missing light token: ${name}`)

  return value
}

// Neutral OKLCH has equal linear RGB channels, each L cubed.
const gray = (lightness: number) => {
  const linear = lightness ** 3

  const channel = Math.round(
    255 * (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055),
  )

  return [channel, channel, channel]
}

const neutral = (name: string) => Number(token(name).match(/^oklch\(([\d.]+) 0 0\)$/)?.[1])

const mixed = (name: string) => {
  const match = token(name).match(
    /^color-mix\(in oklab, var\(--foreground\) (\d+)%, var\(--card\)\)$/,
  )

  if (match === null) throw new Error(`Expected theme-mixed gray: ${name}`)

  const weight = Number(match[1]) / 100

  return gray(neutral("foreground") * weight + neutral("card") * (1 - weight))
}

describe("preview card colors", () => {
  it("encodes the light chart tokens from styles.css in its PNG palette", async () => {
    const names: ReadonlyArray<Ink> = [
      "chart-1",
      "chart-2",
      "chart-3",
      "chart-4",
      "chart-5",
      "chart-6",
      "chart-other",
      "chart-faint",
    ]

    const image = canvas(names.length, 1)

    names.forEach((name, x) => rect(image, { x, y: 0, width: 1, height: 1 }, name))

    const bytes = await png(image)
    // PNG's fixed IHDR chunk is followed by PLTE; its RGB entries start at 41.
    const palette = bytes.subarray(41)

    for (const [x, name] of names.entries()) {
      const expected =
        name === "chart-other" || name === "chart-faint"
          ? mixed(name)
          : [...Buffer.from(token(name).slice(1), "hex")]

      const entry = (image.pixels[x] ?? 0) * 3

      expect([...palette.subarray(entry, entry + 3)]).toEqual(expected)
    }
  })
})
