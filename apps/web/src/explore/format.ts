import {
  type Country,
  countries,
  type IndicatorId,
  type ResolvedView,
  transformOf,
  type View,
} from "@civicdata/domain"
import { DateTime, Match } from "effect"

const countryNames = new Map(countries.map((country) => [country.code, country.name]))

export const countryName = (country: Country) => countryNames.get(country) ?? country

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
const full = new Intl.NumberFormat("en", { maximumFractionDigits: 2 })

export const formatCompact = (value: number) => compact.format(value)

export const formatValue = (value: number) => full.format(value)

// The years a View covers: "2000–2022" for a trend, "2000 and 2022" for a
// change, or "2020" for a single year.
export const period = (view: View) =>
  Match.valueTags(view, {
    Trend: ({ from, to }) => `${from}–${to}`,
    Change: ({ from, to }) => `${from} and ${to}`,
    Ranking: ({ year }) => `${year}`,
    Relation: ({ year }) => `${year}`,
  })

// What the chart's values are when the View has a transform, e.g. "per person".
// Only a trend takes an index.
export const transformLabel = (view: View) =>
  Match.value(transformOf(view)).pipe(
    Match.when("PerPerson", () => "per person"),
    Match.when("Growth", () => "annual % change"),
    Match.when("Index", () =>
      Match.value(view).pipe(
        Match.tag("Trend", (trend) => `index, ${trend.from} = 100`),
        Match.orElse(() => undefined),
      ),
    ),
    Match.orElse(() => undefined),
  )

// Every indicator a resolved View plots: its own, and for a relation the one
// it is plotted against.
export const indicators = (resolved: ResolvedView) =>
  "against" in resolved ? [resolved.indicator, resolved.against.indicator] : [resolved.indicator]

// What to call each indicator the resolved Views at hand plot, by code: its
// plain-language title, or its official name when it has none.
export const indicatorNames = (
  resolved: ReadonlyArray<ResolvedView>,
): ReadonlyMap<IndicatorId, string> =>
  new Map(
    resolved.flatMap((each) =>
      "against" in each
        ? [
            [each.indicator.id, each.title] as const,
            [each.against.indicator.id, each.against.title] as const,
          ]
        : [[each.indicator.id, each.title] as const],
    ),
  )

// What a chart shows, by name: "Population, total", or "Life expectancy
// against GDP per capita" for a relation. A code stands in for a name not
// known yet.
export const subject = (view: View, known: ReadonlyMap<IndicatorId, string>) => {
  const name = (indicator: IndicatorId) => known.get(indicator) ?? indicator

  return Match.value(view).pipe(
    Match.tag(
      "Relation",
      (relation) => `${name(relation.indicator)} against ${name(relation.against)}`,
    ),
    Match.orElse((single) => name(single.indicator)),
  )
}

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
