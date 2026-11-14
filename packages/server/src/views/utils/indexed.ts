import type { Year } from "@repo/domain"

import type { Observations } from "../transforms.types.ts"
import { derived } from "./derived.ts"

// Each value relative to the same country's value in `base`, which is 100. A
// country with no value in `base` is dropped entirely.
export const indexed = (values: Observations, base: Year): Observations => {
  const bases = new Map(
    values.flatMap((observation) =>
      observation.year === base ? [[observation.country, observation]] : [],
    ),
  )

  return values.flatMap((observation) => {
    const start = bases.get(observation.country)

    return start === undefined || start.value === 0
      ? []
      : [derived(observation, { value: (observation.value / start.value) * 100, other: start })]
  })
}
