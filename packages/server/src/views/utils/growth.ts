import type { Observations } from "../transforms.types.ts"
import { derived } from "./derived.ts"
import { key } from "./key.ts"

// Percent change from the same country's previous year. A year whose previous
// year has no value is dropped.
export const growth = (values: Observations): Observations => {
  const byYear = new Map(values.map((observation) => [key(observation), observation]))

  return values.flatMap((observation) => {
    const previous = byYear.get(`${observation.country}:${observation.year - 1}`)

    return previous === undefined || previous.value === 0
      ? []
      : [
          derived(observation, {
            value: (observation.value / previous.value - 1) * 100,
            other: previous,
          }),
        ]
  })
}
