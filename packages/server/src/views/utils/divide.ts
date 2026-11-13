import type { Observations } from "../transforms.types.ts"
import { derived } from "./derived.ts"
import { key } from "./key.ts"

// Each value divided by the same country's value that year in `divisors`, e.g.
// its population. A value with no divisor for its year is dropped, never
// estimated.
export const divide = (values: Observations, divisors: Observations): Observations => {
  const by = new Map(divisors.map((observation) => [key(observation), observation]))

  return values.flatMap((observation) => {
    const divisor = by.get(key(observation))

    return divisor === undefined || divisor.value === 0
      ? []
      : [derived(observation, { value: observation.value / divisor.value, other: divisor })]
  })
}
