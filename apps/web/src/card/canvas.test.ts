// @vitest-environment node
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { colors } from "@/explore/colors.gen"

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

// The RGB of each pixel in the PNG's first row: its IDAT inflated, after the
// row's filter byte.
const firstRow = async (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  let at = 8

  while (new TextDecoder().decode(bytes.subarray(at + 4, at + 8)) !== "IDAT") {
    at += view.getUint32(at) + 12
  }

  const idat = bytes.slice(at + 8, at + 8 + view.getUint32(at))

  const rows = new Uint8Array(
    await new Response(
      new Blob([idat]).stream().pipeThrough(new DecompressionStream("deflate")),
    ).arrayBuffer(),
  )

  return (x: number) => [...rows.subarray(1 + x * 3, 4 + x * 3)]
}

describe("preview card colors", () => {
  it("draws the light chart tokens from styles.css and a country's own colour", async () => {
    const names: ReadonlyArray<Ink> = ["chart-1", "chart-other", "chart-faint", colors.FRA.light]
    const image = canvas(names.length, 1)

    names.forEach((name, x) => rect(image, { x, y: 0, width: 1, height: 1 }, name))

    const pixel = await firstRow(await png(image))

    expect(names.map((_, x) => pixel(x))).toEqual([
      [...Buffer.from(token("chart-1").slice(1), "hex")],
      mixed("chart-other"),
      mixed("chart-faint"),
      [...Buffer.from(colors.FRA.light.slice(1), "hex")],
    ])
  })
})
