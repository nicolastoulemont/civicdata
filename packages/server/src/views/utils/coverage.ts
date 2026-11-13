import type { Country, Covered, Observation, Year } from "@repo/domain"
import { Array as Arr, Order } from "effect"

// The runs of consecutive years in `years`, which are sorted: 2009, 2010,
// 2012 runs 2009 to 2010, then 2012 to 2012.
const runsOf = (years: ReadonlyArray<Year>) =>
  years.reduce<Array<{ from: Year; to: Year }>>((runs, year) => {
    const last = runs.at(-1)

    if (last !== undefined && year === last.to + 1) last.to = year
    else runs.push({ from: year, to: year })

    return runs
  }, [])

// Which years the observations have for each of `countries`, as find_years
// tells them: each country's first and last year, the runs of years every
// country with a value has one in, and the countries without any.
export const coverage = (
  observations: ReadonlyArray<Observation>,
  countries: ReadonlyArray<Country>,
): Omit<typeof Covered.Type, "_tag"> => {
  const yearsOf = (country: Country) =>
    Arr.sort(
      Arr.dedupe(observations.flatMap((each) => (each.country === country ? [each.year] : []))),
      Order.Number,
    )

  const covered = countries.flatMap((country) => {
    const years = yearsOf(country)
    const [first] = years
    const last = years.at(-1)

    return first === undefined || last === undefined ? [] : [{ country, first, last, years }]
  })

  const shared = covered.reduce<ReadonlyArray<Year>>(
    (common, { years }) => common.filter((year) => years.includes(year)),
    covered[0]?.years ?? [],
  )

  return {
    countries: covered.map(({ country, first, last }) => ({ country, first, last })),
    shared: runsOf(shared),
    missing: countries.filter((country) => !covered.some((each) => each.country === country)),
  }
}
