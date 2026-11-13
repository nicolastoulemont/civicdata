import { type ResolvedView, Year } from "@repo/domain"
import { Array as Arr, Schema } from "effect"

import type { Area } from "../Csv.types.ts"
import { layout } from "./layout.ts"
import { rows } from "./rows.ts"

// The flags in one cell, each once.
const flagsIn = (cell: string, area: Area) => [
  ...new Set(cell.split("").flatMap((letter) => area.flags.get(letter) ?? [])),
]

const isYear = Schema.is(Year)

// One value per country and year, and the dimensions that took more than one
// value: when they are not empty, the answer mixed several series.
export const observations = (text: string, area: Area) => {
  const { header, lines } = rows(text)
  const columns = layout(header, area)

  if (columns === undefined) return undefined

  const { time, value, place, flag, dimensions } = columns
  const seen = dimensions.map(() => new Set<string>())
  const found: Array<ResolvedView["observations"][number]> = []

  for (const row of lines) {
    const country = area.country.get(row[place] ?? "")
    const year = Number(row[time])
    const number = row[value] === "" ? Number.NaN : Number(row[value])

    dimensions.forEach(({ index }, position) => seen[position]?.add(row[index] ?? ""))

    const flags = flagsIn(row[flag] ?? "", area)

    if (country !== undefined && isYear(year) && Number.isFinite(number))
      found.push(
        Arr.isArrayNonEmpty(flags)
          ? { country, year, value: number, flags }
          : { country, year, value: number },
      )
  }

  const mixed = dimensions.flatMap(({ id }, position) =>
    (seen[position]?.size ?? 0) > 1 ? [id] : [],
  )

  return { observations: found, mixed }
}
