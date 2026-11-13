import { Dimension } from "@repo/domain"
import { Option, Schema } from "effect"

import type { Area } from "../Csv.types.ts"
import { labelled } from "./labelled.ts"
import { layout } from "./layout.ts"
import { rows } from "./rows.ts"

const decodeDimension = Schema.decodeUnknownOption(Dimension)

// Every dimension in a labelled answer with the values it took, in the order
// the answer lists them, including dimensions that took a single value, and
// the codes of each series, one per dimension in that order. Values a
// dimension takes need not go together: a measure may exist only with
// "not applicable" in another dimension.
export const options = (text: string, area: Area) => {
  const { header, lines } = rows(text)
  const columns = layout(header, area)

  if (columns === undefined) return undefined

  const kept = columns.dimensions.flatMap(({ id, label, index }) => {
    const values = new Map<string, string>()

    for (const row of lines) {
      const cell = labelled(row[index] ?? "")

      if (!values.has(cell.code)) values.set(cell.code, cell.label)
    }

    const dimension = decodeDimension({
      id,
      label,
      options: [...values].map(([code, name]) => ({ code, label: name })),
    })

    return Option.isSome(dimension) ? [{ dimension: dimension.value, index }] : []
  })

  // One row per series and country: a series is listed once.
  const series = new Map<string, ReadonlyArray<string>>()

  for (const row of lines) {
    const codes = kept.map(({ index }) => labelled(row[index] ?? "").code)

    series.set(codes.join(","), codes)
  }

  return { dimensions: kept.map(({ dimension }) => dimension), series: [...series.values()] }
}
