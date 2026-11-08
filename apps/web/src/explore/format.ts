import { type Country, countries, type ResolvedView, type View } from "@civicdata/domain"
import { DateTime, Match } from "effect"

const names = new Map(countries.map((country) => [country.code, country.name]))

export const countryName = (country: Country) => names.get(country) ?? country

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
const full = new Intl.NumberFormat("en", { maximumFractionDigits: 2 })

export const formatCompact = (value: number) => compact.format(value)

export const formatValue = (value: number) => full.format(value)

// The years a View covers: "2000–2022", or "2020" for a ranking.
export const period = (view: View) =>
  Match.valueTags(view, {
    Trend: ({ from, to }) => `${from}–${to}`,
    Ranking: ({ year }) => `${year}`,
  })

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

// When the first series was retrieved; the others were fetched with it.
export const retrieved = (resolved: ResolvedView) =>
  DateTime.toDateUtc(resolved.sources[0].retrievedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

// The credit every chart carries, on the page and on its link-preview card.
export const attribution = (resolved: ResolvedView) =>
  `Source: World Bank, ${[...new Set(resolved.sources.map((source) => source.dataset))].join(", ")}. Retrieved ${retrieved(resolved)}.`
