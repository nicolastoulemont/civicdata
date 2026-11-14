import type { Area } from "../Csv.types.ts"
import { fields } from "./fields.ts"
import { labelled } from "./labelled.ts"

// Where each field sits: the header names the time, value and country
// columns, and the dimension columns sit between the structure columns and
// OBS_VALUE.
export const layout = (header: string, area: Area) => {
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
