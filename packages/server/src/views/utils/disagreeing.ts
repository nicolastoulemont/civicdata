import type { ResolvedView } from "@repo/domain"

type Observations = ResolvedView["observations"]

// The other source's values that differ from the chart's for the same
// country and year by more than 1% of the larger: more than rounding.
export const disagreeing = (shown: Observations, other: Observations) => {
  const values = new Map(shown.map(({ country, year, value }) => [`${country}:${year}`, value]))

  return other.filter(({ country, year, value }) => {
    const ours = values.get(`${country}:${year}`)

    return (
      ours !== undefined &&
      Math.abs(ours - value) > 0.01 * Math.max(Math.abs(ours), Math.abs(value))
    )
  })
}
