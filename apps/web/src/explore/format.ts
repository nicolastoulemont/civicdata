import {
  type Country,
  countries,
  type IndicatorId,
  type ResolvedView,
  type Source,
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

// What the chart's values are when the View has a transform, e.g. "per person"
// or "per GDP (current US$)". Only a trend takes an index. A code stands in
// for a name not known yet.
export const transformLabel = (view: View, known: ReadonlyMap<IndicatorId, string>) =>
  Match.value(transformOf(view)).pipe(
    Match.when("PerPerson", () => "per person"),
    Match.when("Growth", () => "annual % change"),
    Match.when("Index", () =>
      Match.value(view).pipe(
        Match.tag("Trend", (trend) => `index, ${trend.from} = 100`),
        Match.orElse(() => undefined),
      ),
    ),
    Match.when({ _tag: "Ratio" }, ({ per }) => `per ${known.get(per) ?? per}`),
    Match.orElse(() => undefined),
  )

// Every indicator a resolved View plots: its own, and for a relation the one
// it is plotted against.
export const indicators = (resolved: ResolvedView) =>
  "against" in resolved ? [resolved.indicator, resolved.against.indicator] : [resolved.indicator]

// What to call each indicator the resolved Views at hand cite, by code: a
// plotted indicator by its plain-language title, or its official name when it
// has none; any other series, such as the one a ratio divides by, by its
// official name.
export const indicatorNames = (
  resolved: ReadonlyArray<ResolvedView>,
): ReadonlyMap<IndicatorId, string> =>
  new Map(
    resolved.flatMap((each) => [
      ...each.sources.map((source) => [source.indicator, source.name] as const),
      [each.indicator.id, each.title] as const,
      ...("against" in each ? [[each.against.indicator.id, each.against.title] as const] : []),
    ]),
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

// The values the View picks of its indicator's dimensions, by label, e.g.
// ["From 15 to 74 years", "Total"]. Empty for a World Bank indicator.
export const picks = (resolved: ResolvedView) =>
  resolved.dimensions.flatMap((dimension) => {
    const picked = dimension.options.find(
      (option) => option.code === resolved.view.dimensions?.[dimension.id],
    )

    return picked === undefined ? [] : [picked.label]
  })

// When the first series was retrieved; the others were fetched with it.
export const retrieved = (resolved: ResolvedView) =>
  DateTime.toDateUtc(resolved.sources[0].retrievedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

// A source as the start of a sentence: "The World Bank", "Eurostat", "The OECD".
export const named = (source: Source) => (source === "Eurostat" ? source : `The ${source}`)

// The credit every chart carries, on the page and on its link-preview card:
// each source with the datasets taken from it, e.g. "Source: Eurostat,
// Population on 1 January; World Bank, World Development Indicators."
export const attribution = (resolved: ResolvedView) => {
  const datasets = new Map<Source, Set<string>>()

  for (const { source, dataset } of resolved.sources)
    datasets.set(source, (datasets.get(source) ?? new Set()).add(dataset))

  const credits = [...datasets].map(([source, each]) => `${source}, ${[...each].join(", ")}`)

  return `Source: ${credits.join("; ")}. Retrieved ${retrieved(resolved)}.`
}

// The source's own page for a series fetched to draw the chart.
export const page = ({ source, indicator }: ResolvedView["sources"][number]) => {
  const [agency = "", id = ""] = indicator.split(",")

  return Match.value(source).pipe(
    Match.when("World Bank", () => `https://data.worldbank.org/indicator/${indicator}`),
    Match.when(
      "Eurostat",
      () => `https://ec.europa.eu/eurostat/databrowser/view/${id.toLowerCase()}/default/table`,
    ),
    Match.when(
      "OECD",
      () =>
        `https://data-explorer.oecd.org/vis?df[ds]=dsDisseminateFinalDMZ&df[id]=${encodeURIComponent(id)}&df[ag]=${agency}`,
    ),
    Match.exhaustive,
  )
}
