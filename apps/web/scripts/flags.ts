// Writes scripts/flags.json: the colours of each country's flag and the share
// of the flag each covers, measured from the flag-icons SVG flags (MIT
// licence). scripts/colors.ts derives each country's chart colours from it.
// Run with `pnpm --filter @civicdata/web run flags`, then `pnpm format`, after
// upgrading flag-icons or when the domain's country list changes.
import { readFileSync, writeFileSync } from "node:fs"

import { countries } from "@civicdata/domain"
import { Resvg } from "@resvg/resvg-js"

import { distance, hex, lab, type Lab, type Rgb } from "./oklab.ts"

const read = (file: string) => readFileSync(new URL(import.meta.resolve(file)), "utf8")

const version: string = JSON.parse(read("flag-icons/package.json")).version

// [alpha-2, alpha-3, numeric] for every ISO 3166-1 country.
const codes: ReadonlyArray<readonly [string, string, string]> = JSON.parse(
  read("i18n-iso-countries/codes.json"),
)

// flag-icons names a flag by its alpha-2 code. Kosovo has no ISO code (the
// World Bank calls it XKX), and the Channel Islands have no flag of their
// own: Jersey's stands in.
const flagOf = new Map<string, string>([
  ...codes.map(([two, three]) => [three, two.toLowerCase()] as const),
  ["XKX", "xk"],
  ["CHI", "je"],
])

// Antialiased edges blend two colours. A colour within this OKLab distance of
// a more common one counts as that colour.
const same = 0.08

// Colours covering less of the flag than this are details: a coat of arms,
// a star's outline.
const least = 0.02

interface Measured {
  rgb: Rgb
  lab: Lab
  pixels: number
}

// The flag drawn 160 pixels wide on white, its pixels counted by colour, most
// common first, with near colours merged.
const measure = (flag: string) => {
  const svg = read(`flag-icons/flags/4x3/${flag}.svg`)

  const pixels = new Resvg(svg, {
    fitTo: { mode: "width", value: 160 },
    background: "white",
  }).render().pixels

  const counts = new Map<number, number>()

  for (let at = 0; at < pixels.length; at += 4) {
    const key = ((pixels[at] ?? 0) << 16) | ((pixels[at + 1] ?? 0) << 8) | (pixels[at + 2] ?? 0)

    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const merged: Array<Measured> = []

  for (const [key, count] of [...counts].toSorted((left, right) => right[1] - left[1])) {
    const rgb: Rgb = [key >> 16, (key >> 8) & 255, key & 255]
    const near = merged.find((each) => distance(each.lab, lab(rgb)) < same)

    if (near === undefined) merged.push({ rgb, lab: lab(rgb), pixels: count })
    else near.pixels += count
  }

  const total = pixels.length / 4

  return merged.flatMap((each) =>
    each.pixels / total < least
      ? []
      : [{ color: hex(each.rgb), share: Math.round((each.pixels / total) * 1000) / 1000 }],
  )
}

const flags = Object.fromEntries(
  countries.map(({ code }) => {
    const flag = flagOf.get(code)

    if (flag === undefined) throw new Error(`No flag for ${code}`)

    return [code, { flag, colors: measure(flag) }]
  }),
)

writeFileSync(
  new URL("flags.json", import.meta.url),
  `${JSON.stringify({
    source: `flag-icons ${version}, flags/4x3, https://github.com/lipis/flag-icons`,
    licence: "MIT, Copyright (c) 2013 Panayiotis Lipiridis",
    flags,
  })}\n`,
)
