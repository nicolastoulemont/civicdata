import type { ResolvedView, Year } from "@openfacts/domain"
import { Array as Arr } from "effect"

type Observations = ResolvedView["observations"]

type Observation = Observations[number]

const key = (observation: Observation) => `${observation.country}:${observation.year}`

// A value computed from `observation` and `other`, which keeps the flags of
// both: growth from a provisional year is provisional too.
const derived = (
  observation: Observation,
  { value, other }: { value: number; other: Observation },
) => {
  const flags = [...new Set([...(observation.flags ?? []), ...(other.flags ?? [])])]
  const { country, year } = observation

  return Arr.isArrayNonEmpty(flags) ? { country, year, value, flags } : { country, year, value }
}

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
