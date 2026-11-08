import type { ResolvedView, Year } from "@civicdata/domain"

type Observations = ResolvedView["observations"]

const key = (observation: Observations[number]) => `${observation.country}:${observation.year}`

// Each value divided by the same country's population that year. A value with
// no population for its year is dropped, never estimated.
export const perPerson = (values: Observations, population: Observations): Observations => {
  const people = new Map(population.map((observation) => [key(observation), observation.value]))

  return values.flatMap((observation) => {
    const divisor = people.get(key(observation))

    return divisor === undefined || divisor === 0
      ? []
      : [{ ...observation, value: observation.value / divisor }]
  })
}

// Percent change from the same country's previous year. A year whose previous
// year has no value is dropped.
export const growth = (values: Observations): Observations => {
  const byYear = new Map(values.map((observation) => [key(observation), observation.value]))

  return values.flatMap((observation) => {
    const previous = byYear.get(`${observation.country}:${observation.year - 1}`)

    return previous === undefined || previous === 0
      ? []
      : [{ ...observation, value: (observation.value / previous - 1) * 100 }]
  })
}

// Each value relative to the same country's value in `base`, which is 100. A
// country with no value in `base` is dropped entirely.
export const indexed = (values: Observations, base: Year): Observations => {
  const bases = new Map(
    values.flatMap((observation) =>
      observation.year === base ? [[observation.country, observation.value]] : [],
    ),
  )

  return values.flatMap((observation) => {
    const start = bases.get(observation.country)

    return start === undefined || start === 0
      ? []
      : [{ ...observation, value: (observation.value / start) * 100 }]
  })
}
