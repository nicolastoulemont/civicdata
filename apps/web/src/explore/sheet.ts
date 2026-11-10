import { type Country, european, type ResolvedView } from "@civicdata/domain"

import { europe } from "./europe.gen.ts"
import { world } from "./world.gen.ts"

// An outline as rings: the first point of each, then the step to each next
// point, all in whole units.
export type Steps = ReadonlyArray<ReadonlyArray<number>>

// An overseas region in its own box beside the map, `width` by `height`
// units. Our data is national, so it takes its country's shade.
export interface Inset {
  readonly name: string
  readonly country: Country
  readonly width: number
  readonly height: number
  readonly outline: Steps
}

// One projected map, `width` by `height` units: each country it can draw,
// the land around them, and its insets.
export interface Sheet {
  readonly name: "World" | "Europe"
  readonly width: number
  readonly height: number
  readonly outlines: Readonly<Partial<Record<Country, Steps>>>
  readonly land: Steps
  readonly insets: ReadonlyArray<Inset>
}

// The map of Europe when every country is European, else the world.
export const sheetOf = (countries: ReadonlyArray<Country>): Sheet =>
  countries.every((country) => european.has(country)) ? europe : world

type Point = readonly [number, number]

// An outline as rings of points, for the card to fill.
export const rings = (outline: Steps): ReadonlyArray<ReadonlyArray<Point>> =>
  outline.map((steps) => {
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

// An outline as an SVG path, for the page to draw.
export const path = (outline: Steps) =>
  outline.map(([x = 0, y = 0, ...steps]) => `M${x} ${y}l${steps.join(" ")}z`).join("")

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

// The countries too small to draw on a sheet, e.g. Singapore on the world.
export const offMap = (sheet: Sheet, countries: ReadonlyArray<Country>) =>
  countries.filter((country) => sheet.outlines[country] === undefined)
