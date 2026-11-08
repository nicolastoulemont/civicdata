import { type Country, countries, type View } from "@civicdata/domain"
import { Match } from "effect"

const names = new Map(countries.map((country) => [country.code, country.name]))

export const countryName = (country: Country) => names.get(country) ?? country

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
const full = new Intl.NumberFormat("en", { maximumFractionDigits: 2 })

export const formatCompact = (value: number) => compact.format(value)

export const formatValue = (value: number) => full.format(value)

// What the chart's values are when the View has a transform, e.g. "per person".
export const transformLabel = (view: View) =>
  Match.value(view.transform).pipe(
    Match.when("PerPerson", () => "per person"),
    Match.when("Growth", () => "annual % change"),
    Match.when(
      "Index",
      () =>
        `index, ${Match.valueTags(view, { Trend: (trend) => trend.from, Ranking: (ranking) => ranking.year })} = 100`,
    ),
    Match.orElse(() => undefined),
  )
