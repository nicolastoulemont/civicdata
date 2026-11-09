import {
  type Country,
  countries,
  Dimension,
  type Flag,
  type ResolvedView,
  Year,
} from "@civicdata/domain"
import { Array as Arr, Option, Schema } from "effect"

import { geo } from "./geo.ts"

// SDMX-CSV 2.0, as Eurostat and the OECD answer data queries. Parsed by hand:
// a schema per row costs more CPU than a Worker on the free plan gets.

// Where each source names the country in its data, and how, and where it
// flags a value. OECD codes are ISO 3166-1 alpha-3, like ours; Eurostat's
// are two letters. Each letter of a flag cell is one flag: Eurostat writes
// "ep" for estimated and provisional.
export interface Area {
  readonly column: string
  readonly country: ReadonlyMap<string, Country>
  readonly flag: string
  readonly flags: ReadonlyMap<string, Flag>
}

export const areas: Record<"Eurostat" | "OECD", Area> = {
  Eurostat: {
    column: "geo",
    country: new Map(countries.map(({ code }) => [geo[code], code])),
    // "s" is an estimate Eurostat made itself, rather than the country.
    flag: "OBS_FLAG",
    flags: new Map([
      ["p", "Provisional"],
      ["e", "Estimated"],
      ["s", "Estimated"],
      ["b", "Break"],
    ]),
  },
  OECD: {
    column: "REF_AREA",
    country: new Map(countries.map(({ code }) => [code, code])),
    flag: "OBS_STATUS",
    flags: new Map([
      ["P", "Provisional"],
      ["E", "Estimated"],
      ["B", "Break"],
    ]),
  },
}

// The flags in one cell, each once.
const flagsIn = (cell: string, area: Area) => [
  ...new Set(cell.split("").flatMap((letter) => area.flags.get(letter) ?? [])),
]

const isYear = Schema.is(Year)

const decodeDimension = Schema.decodeUnknownOption(Dimension)

// One line, with RFC 4180 quoting. Codes and numbers are never quoted;
// attributes and labels may be.
const fields = (line: string) => {
  if (!line.includes('"')) return line.split(",")

  const values: Array<string> = []
  let value = ""
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (quoted && char === '"' && line[index + 1] === '"') {
      value += '"'
      index += 1
    } else if (char === '"') quoted = !quoted
    else if (char === "," && !quoted) {
      values.push(value)
      value = ""
    } else value += char
  }

  values.push(value)

  return values
}

// A labelled answer (`labels=both`) writes "code: label" in each header and
// dimension cell; an unlabelled one writes the code alone.
const labelled = (cell: string) => {
  const at = cell.indexOf(": ")

  return at === -1
    ? { code: cell, label: cell }
    : { code: cell.slice(0, at), label: cell.slice(at + 2) }
}

// Where each field sits: the header names the time, value and country
// columns, and the dimension columns sit between the structure columns and
// OBS_VALUE.
const layout = (header: string, area: Area) => {
  const columns = fields(header).map(labelled)
  const at = (id: string) => columns.findIndex((column) => column.code === id)
  const time = at("TIME_PERIOD")
  const value = at("OBS_VALUE")
  const place = at(area.column)
  const first = Math.max(at("STRUCTURE_ID"), at("ACTION")) + 1

  const dimensions = columns
    .slice(first, value)
    .flatMap((column, offset) =>
      column.code === area.column || column.code === "TIME_PERIOD"
        ? []
        : [{ id: column.code, label: column.label, index: first + offset }],
    )

  return time === -1 || value === -1 || place === -1
    ? undefined
    : { time, value, place, flag: at(area.flag), dimensions }
}

const rows = (text: string) => {
  const [header = "", ...lines] = text.split(/\r?\n/)

  return { header, lines: lines.filter((line) => line !== "").map(fields) }
}

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

// Every dimension in a labelled answer with the values it took, in the order
// the answer lists them, including dimensions that took a single value.
export const dimensions = (text: string, area: Area) => {
  const { header, lines } = rows(text)
  const columns = layout(header, area)

  if (columns === undefined) return undefined

  return columns.dimensions.flatMap(({ id, label, index }) => {
    const options = new Map<string, string>()

    for (const row of lines) {
      const cell = labelled(row[index] ?? "")

      if (!options.has(cell.code)) options.set(cell.code, cell.label)
    }

    const dimension = decodeDimension({
      id,
      label,
      options: [...options].map(([code, name]) => ({ code, label: name })),
    })

    return Option.isSome(dimension) ? [dimension.value] : []
  })
}
