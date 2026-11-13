import type { Change, Country, Direction, ResolvedView } from "@repo/domain"

type Observations = ResolvedView["observations"]

const valueOf = (
  observations: Observations,
  { country, year }: { country: Country; year: number },
) =>
  observations.find((observation) => observation.country === country && observation.year === year)
    ?.value

// What a change chart draws: each country with a value in both years, the
// largest rise first.
export const changes = (resolved: ResolvedView, change: Change) =>
  change.countries
    .flatMap((country) => {
      const from = valueOf(resolved.observations, { country, year: change.from })
      const to = valueOf(resolved.observations, { country, year: change.to })

      return from === undefined || to === undefined ? [] : [{ country, from, to }]
    })
    .toSorted((left, right) => right.to - right.from - (left.to - left.from))

// Which way a country moved between a change's two years, for an indicator
// with a direction: the better way, the worse way, or not at all.
export const moved = (
  direction: Exclude<Direction, "Neutral">,
  { from, to }: { from: number; to: number },
) => {
  if (to === from) return "same"

  return to > from === (direction === "Higher") ? "better" : "worse"
}

// A resolved relation: its indicator's values and those it is plotted against.
export type Paired = Extract<ResolvedView, { readonly against: object }>

// What a relation chart draws: each country with a value for both indicators,
// `x` the one it is plotted against.
export const pairs = (resolved: Paired) =>
  resolved.view.countries.flatMap((country) => {
    const at = { country, year: resolved.view.year }
    const y = valueOf(resolved.observations, at)
    const x = valueOf(resolved.against.observations, at)

    return x === undefined || y === undefined ? [] : [{ country, x, y }]
  })

// Each country's dot in every year it has a value for both indicators,
// oldest first: the path a relation over time moves it along.
export const paths = (resolved: Paired) => {
  const against = new Map(
    resolved.against.observations.map(({ country, year, value }) => [`${country} ${year}`, value]),
  )

  return resolved.view.countries.map((country) => ({
    country,
    points: resolved.observations
      .filter((observation) => observation.country === country)
      .toSorted((left, right) => left.year - right.year)
      .flatMap(({ year, value }) => {
        const x = against.get(`${country} ${year}`)

        return x === undefined ? [] : [{ year, x, y: value }]
      }),
  }))
}
