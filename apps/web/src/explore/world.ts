import type { Country, ResolvedView } from "@civicdata/domain"

import { outlines } from "./world.gen.ts"

export { height, width } from "./world.gen.ts"

type Point = readonly [number, number]

// A country's outline as rings of points, for the card to fill, or none when
// it is too small to draw.
export const rings = (country: Country): ReadonlyArray<ReadonlyArray<Point>> =>
  (outlines[country] ?? []).map((steps) => {
    const points: Array<Point> = []
    let x = 0
    let y = 0

    for (let index = 0; index + 1 < steps.length; index += 2) {
      x += steps[index] ?? 0
      y += steps[index + 1] ?? 0
      points.push([x, y])
    }

    return points
  })

// A country's outline as an SVG path, for the page to draw.
export const path = (country: Country) =>
  (outlines[country] ?? [])
    .map(([x = 0, y = 0, ...steps]) => `M${x} ${y}l${steps.join(" ")}z`)
    .join("")

// How many shades a map uses, lightest for the lowest values.
const shadeCount = 5

// Each country's shade by rank: the countries with a value split into five
// groups of about the same size, lowest first. Each shade's range of values
// keys the map.
export const shades = (observations: ResolvedView["observations"]) => {
  const ranked = observations.toSorted((left, right) => left.value - right.value)
  const shadeOf = (rank: number) => Math.floor((rank * shadeCount) / ranked.length)

  const byCountry = new Map<Country, number>(
    ranked.map((observation, rank) => [observation.country, shadeOf(rank)]),
  )

  const groups = Array.from({ length: shadeCount }, (): Array<number> => [])

  for (const [rank, observation] of ranked.entries()) groups[shadeOf(rank)]?.push(observation.value)

  // Values are ranked lowest first, so each group runs from its first to its last.
  const key = groups.flatMap((values, shade) => {
    const [low] = values
    const high = values.at(-1)

    return low === undefined || high === undefined ? [] : [{ shade, low, high }]
  })

  return { byCountry, key }
}

// The requested countries too small to draw at this scale, e.g. Singapore.
export const offMap = (countries: ReadonlyArray<Country>) =>
  countries.filter((country) => outlines[country] === undefined)
