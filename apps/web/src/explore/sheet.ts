import { type Country, type Region, type ResolvedView } from "@repo/domain"

import { sheets } from "./maps/sheets.gen.ts"

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
  readonly width: number
  readonly height: number
  readonly outlines: Readonly<Partial<Record<Country, Steps>>>
  readonly land: Steps
  readonly insets: ReadonlyArray<Inset>
}

const loaded = new Map<Region["id"] | "world", Promise<Sheet>>()

// A region's map, or the world's when there is none. Each map's outlines are
// their own module, imported the first time it is drawn, so a page loads only
// the maps it shows. Every call returns the same promise, as React's `use`
// needs.
export const load = (region: Region | undefined) => {
  const id = region?.id ?? "world"
  const loading = loaded.get(id) ?? sheets[id]()

  loaded.set(id, loading)

  return loading
}

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

// One shade's range of values, as a map's key shows it.
export interface Band {
  readonly shade: number
  readonly low: number
  readonly high: number
}

// Shades fixed across a span of years: every value of every year, split into
// five groups of about the same size, lowest first. A shade then means the
// same values in each year, so a country that darkens has grown past others'
// earlier values, not only overtaken its neighbours.
export const bands = (observations: ResolvedView["observations"]): ReadonlyArray<Band> =>
  shades(observations).key

// Each country's shade on bands fixed across a span: the first band its
// value does not exceed.
export const banded = (
  observations: ResolvedView["observations"],
  key: ReadonlyArray<Band>,
): ReadonlyMap<Country, number> =>
  new Map(
    observations.flatMap(({ country, value }) => {
      const band = key.find(({ high }) => value <= high)

      return band === undefined ? [] : [[country, band.shade] as const]
    }),
  )

// The countries too small to draw on a sheet, e.g. Singapore on the world.
export const offMap = (sheet: Sheet, countries: ReadonlyArray<Country>) =>
  countries.filter((country) => sheet.outlines[country] === undefined)
