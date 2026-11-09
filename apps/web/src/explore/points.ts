import type { Change, Country, ResolvedView } from "@civicdata/domain"

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
