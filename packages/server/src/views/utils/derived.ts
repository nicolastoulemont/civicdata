import { Array as Arr } from "effect"

import type { Observation } from "../transforms.types.ts"

// A value computed from `observation` and `other`, which keeps the flags of
// both: growth from a provisional year is provisional too.
export const derived = (
  observation: Observation,
  { value, other }: { value: number; other: Observation },
) => {
  const flags = [...new Set([...(observation.flags ?? []), ...(other.flags ?? [])])]
  const { country, year } = observation

  return Arr.isArrayNonEmpty(flags) ? { country, year, value, flags } : { country, year, value }
}
