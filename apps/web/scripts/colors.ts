// Writes src/explore/colors.gen.ts: each country's own colour, the same in
// every chart, in a light-theme and a dark-theme version. Each starts from its
// flag's most distinctive colour in scripts/flags.json and keeps 3:1 contrast
// against the card in both themes. Run with
// `pnpm --filter @openfacts/web run colors`, then `pnpm format`, after
// changing flags.json or the card colours in styles.css. It prints the
// closest pairs among EU and OECD members.
import { readFileSync, writeFileSync } from "node:fs"

import { countries, Country, members } from "@openfacts/domain"
import { Schema } from "effect"

import {
  chroma,
  contrast,
  distance,
  fromLch,
  gray,
  hex,
  hue,
  lab,
  type Lab,
  parse,
  type Rgb,
} from "./oklab.ts"

const Hex = Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}$/))

const Snapshot = Schema.Struct({
  source: Schema.String,
  licence: Schema.String,
  flags: Schema.Record(
    Country,
    Schema.Struct({
      flag: Schema.String,
      colors: Schema.Array(Schema.Struct({ color: Hex, share: Schema.Number })),
    }),
  ),
})

const snapshot = Schema.decodeUnknownSync(Snapshot)(
  JSON.parse(readFileSync(new URL("flags.json", import.meta.url), "utf8")),
)

// The card's colour in each theme, a neutral OKLCH lightness in styles.css.
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8")
const [light = "", dark = ""] = css.split("@variant dark")

const card = (section: string): Rgb => {
  const lightness = section.match(/ {2,}--card: oklch\(([\d.]+) 0 0\);/)?.[1]

  if (lightness === undefined) throw new Error("Missing --card in styles.css")

  return gray(Number(lightness))
}

const backgrounds = { light: card(light), dark: card(dark) }

// WCAG's minimum for lines and other graphics.
const least = 3

// White, black and grays tell no flag apart, and a colour under 5% of the
// flag is a detail: a coat of arms, a star's outline.
const neutral = 0.04
const detail = 0.05

interface Hue {
  readonly angle: number
  readonly share: number
}

// FNV-1a: a fixed number from a country's name.
const hash = (name: string) => {
  let value = 0x811c9dc5

  for (const character of name) {
    value ^= character.codePointAt(0) ?? 0
    value = Math.imul(value, 0x01000193) >>> 0
  }

  return value
}

// The hues of the flag's colours that tell it apart, with their share of the
// flag. A flag of neutrals only takes a hue from the country's name.
const hues = ({ code, name }: (typeof countries)[number]): ReadonlyArray<Hue> => {
  const found = snapshot.flags[code].colors.flatMap(({ color, share }) => {
    const point = lab(parse(color))

    return chroma(point) < neutral || share < detail ? [] : [{ angle: hue(point), share }]
  })

  return found.length > 0 ? found : [{ angle: (hash(name) / 2 ** 32) * 2 * Math.PI, share: 1 }]
}

interface Candidate {
  // How far it strays from the flag: weighed against its distance from the
  // colours already taken.
  readonly cost: number
  readonly light: Rgb
  readonly dark: Rgb
  readonly points: readonly [Lab, Lab]
}

// The grid searched around each hue: up to 40 degrees either side, in OKLCH.
// A dark version is its light one made lighter by a fixed step, so the two
// read as one colour.
const turns = Array.from({ length: 21 }, (_, index) => index * 4 - 40)
const lightnesses = [0.4, 0.45, 0.5, 0.55, 0.6]
const chromas = [0.08, 0.11, 0.14, 0.17, 0.2, 0.23]
const lighter = 0.24

// What straying costs: per degree turned, for taking a smaller colour of the
// flag than its largest, and per unit of chroma under the most vivid.
const perDegree = 0.0004
const perShare = 0.03
const perChroma = 0.15

// Every colour near one of the flag's hues that stays in the sRGB gamut and
// keeps 3:1 against the card in both themes.
const candidates = (flag: ReadonlyArray<Hue>): ReadonlyArray<Candidate> => {
  const most = Math.max(...flag.map(({ share }) => share))
  const vivid = Math.max(...chromas)

  return flag.flatMap(({ angle, share }) =>
    turns.flatMap((turn) =>
      lightnesses.flatMap((lightness) =>
        chromas.flatMap((amount) => {
          const turned = angle + (turn * Math.PI) / 180
          const forLight = fromLch(lightness, amount, turned)
          const forDark = fromLch(lightness + lighter, amount, turned)

          if (
            forLight === undefined ||
            forDark === undefined ||
            contrast(forLight, backgrounds.light) < least ||
            contrast(forDark, backgrounds.dark) < least
          )
            return []

          const cost =
            perDegree * Math.abs(turn) +
            perShare * (1 - share / most) +
            perChroma * (vivid - amount)

          return [
            {
              cost,
              light: forLight,
              dark: forDark,
              points: [lab(forLight), lab(forDark)] as const,
            },
          ]
        }),
      ),
    ),
  )
}

// How far apart two colours look: the nearer of their two themes.
const apart = (left: Candidate, right: Candidate) =>
  Math.min(distance(left.points[0], right.points[0]), distance(left.points[1], right.points[1]))

// The G7 picks first, since its seven countries share charts most often;
// then the other EU and OECD members; then every other country. Within each
// group the name's hash sets the order. Each takes the candidate farthest
// from the colours already taken, less what it costs to stray from the flag,
// and never one already taken.
const g7: ReadonlySet<Country> = new Set(["CAN", "FRA", "DEU", "ITA", "JPN", "GBR", "USA"])

const rank = (code: Country) => (g7.has(code) ? 0 : members.has(code) ? 1 : 2)

const ordered = countries.toSorted(
  (left, right) => rank(left.code) - rank(right.code) || hash(left.name) - hash(right.name),
)

const taken = new Map<Country, Candidate>()

// Past this OKLab distance two colours are apart enough; nearer ones count.
const far = 0.3

const used = new Set<string>()

for (const country of ordered) {
  const rivals = [...taken.values()]

  const best = candidates(hues(country))
    .filter((candidate) => !used.has(hex(candidate.light)) && !used.has(hex(candidate.dark)))
    .map((candidate) => ({
      candidate,
      score: Math.min(far, ...rivals.map((rival) => apart(candidate, rival))) - candidate.cost,
    }))
    .toSorted((left, right) => right.score - left.score)[0]?.candidate

  if (best === undefined) throw new Error(`No colour for ${country.code}`)

  taken.set(country.code, best)
  used.add(hex(best.light)).add(hex(best.dark))
}

const rows = countries.map(({ code }) => {
  const color = taken.get(code)

  if (color === undefined) throw new Error(`No colour for ${code}`)

  return `  ${code}: { light: "${hex(color.light)}", dark: "${hex(color.dark)}" },`
})

writeFileSync(
  new URL("../src/explore/colors.gen.ts", import.meta.url),
  [
    "// Generated by scripts/colors.ts from scripts/flags.json, measured from",
    `// ${snapshot.source}`,
    `// (${snapshot.licence}). Do not edit.`,
    'import type { Country } from "@openfacts/domain"',
    "",
    "export const colors = {",
    ...rows,
    "} as const satisfies Record<Country, { light: `#${string}`; dark: `#${string}` }>",
    "",
  ].join("\n"),
)

// The closest pairs of a group of countries, in OKLab, in each theme.
const eu: ReadonlyArray<Country> = [
  "AUT",
  "BEL",
  "BGR",
  "HRV",
  "CYP",
  "CZE",
  "DNK",
  "EST",
  "FIN",
  "FRA",
  "DEU",
  "GRC",
  "HUN",
  "IRL",
  "ITA",
  "LVA",
  "LTU",
  "LUX",
  "MLT",
  "NLD",
  "POL",
  "PRT",
  "ROU",
  "SVK",
  "SVN",
  "ESP",
  "SWE",
]

// The domain's members less the five EU members outside the OECD.
const oecd = [...members].filter((code) => !["BGR", "CYP", "HRV", "MLT", "ROU"].includes(code))

const closest = (group: ReadonlyArray<Country>, theme: 0 | 1) =>
  group
    .flatMap((left, index) =>
      group.slice(index + 1).map((right) => {
        const one = taken.get(left)
        const other = taken.get(right)

        return {
          pair: `${left}-${right}`,
          apart:
            one === undefined || other === undefined
              ? 0
              : distance(one.points[theme], other.points[theme]),
        }
      }),
    )
    .toSorted((left, right) => left.apart - right.apart)
    .slice(0, 5)
    .map(({ pair, apart: gap }) => `${pair} ${gap.toFixed(3)}`)
    .join(", ")

for (const [label, group] of [
  ["EU 27", eu],
  ["OECD", oecd],
  ["G7", [...g7]],
  ["All", countries.map(({ code }) => code)],
] as const) {
  console.log(`${label}, light: ${closest(group, 0)}`)
  console.log(`${label}, dark:  ${closest(group, 1)}`)
}
