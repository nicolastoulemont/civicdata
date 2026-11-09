import {
  applies,
  Change,
  IndicatorId,
  Ranking,
  Ratio,
  Relation,
  type Transform,
  transformOf,
  Trend,
  type View,
  Year,
} from "@civicdata/domain"
import { Match } from "effect"

// Edits a user makes to a View through the page's controls. Each returns a
// valid View: the `make` constructors check it.

interface Picked {
  readonly id: IndicatorId
  readonly name: string
}

// Sets or clears the transform where the chart type takes it: a ranking has no
// first year to index to, a change takes only "per person" and a ratio, a
// relation none. A ratio of the indicator to itself, 1 everywhere, is cleared.
export const withTransform = (view: View, transform: Transform | undefined) => {
  const kept = Match.value(transform).pipe(
    Match.when({ _tag: "Ratio" }, (ratio) => (ratio.per === view.indicator ? undefined : ratio)),
    Match.orElse((other) => other),
  )

  return Match.valueTags(view, {
    Trend: ({ indicator, countries, from, to }) =>
      kept === undefined
        ? Trend.make({ indicator, countries, from, to })
        : Trend.make({ indicator, countries, from, to, transform: kept }),
    Ranking: ({ indicator, countries, year }) =>
      kept === undefined || kept === "Index"
        ? Ranking.make({ indicator, countries, year })
        : Ranking.make({ indicator, countries, year, transform: kept }),
    Change: ({ indicator, countries, from, to }) =>
      kept === undefined || kept === "Growth" || kept === "Index"
        ? Change.make({ indicator, countries, from, to })
        : Change.make({ indicator, countries, from, to, transform: kept }),
    Relation: (relation) => relation,
  })
}

// Switches indicator, keeping the transform only if the new one takes it. A
// relation given the indicator it is plotted against swaps its two axes.
export const withIndicator = (view: View, indicator: Picked) => {
  const transform = transformOf(view)

  const switched = Match.valueTags(view, {
    Trend: ({ countries, from, to }) =>
      Trend.make({ indicator: indicator.id, countries, from, to }),
    Ranking: ({ countries, year }) => Ranking.make({ indicator: indicator.id, countries, year }),
    Change: ({ countries, from, to }) =>
      Change.make({ indicator: indicator.id, countries, from, to }),
    Relation: (relation) =>
      Relation.make({
        ...relation,
        indicator: indicator.id,
        against: indicator.id === relation.against ? relation.indicator : relation.against,
      }),
  })

  return transform === undefined || !applies(transform, indicator.name)
    ? switched
    : withTransform(switched, transform)
}

// What a ratio first divides by: GDP, or population when the indicator is GDP.
const gdp = IndicatorId.make("NY.GDP.MKTP.CD")
const population = IndicatorId.make("SP.POP.TOTL")

export const ratioFor = (indicator: IndicatorId) =>
  Ratio.make({ per: indicator === gdp ? population : gdp })

// Switches the indicator a ratio divides by. The chart's own indicator clears
// the ratio.
export const withPer = (view: View, per: Picked) => withTransform(view, Ratio.make({ per: per.id }))

// Switches the indicator a relation is plotted against. Picking its own
// indicator swaps the two axes.
export const withAgainst = (relation: Relation, against: Picked) =>
  Relation.make({
    indicator: against.id === relation.indicator ? relation.against : relation.indicator,
    against: against.id,
    countries: relation.countries,
    year: relation.year,
  })

export const withCountries = (view: View, countries: View["countries"]) =>
  Match.valueTags(view, {
    Trend: (trend) => Trend.make({ ...trend, countries }),
    Ranking: (ranking) => Ranking.make({ ...ranking, countries }),
    Change: (change) => Change.make({ ...change, countries }),
    Relation: (relation) => Relation.make({ ...relation, countries }),
  })

// How far back a single year turned into a range of years looks.
const rangeYears = 20

// The years a View covers. A single year becomes the twenty years leading to
// it, from 1960 at the earliest.
const span = (view: View) =>
  Match.valueTags(view, {
    Trend: ({ from, to }) => ({ from, to }),
    Change: ({ from, to }) => ({ from, to }),
    Ranking: ({ year }) => ({ from: Year.make(Math.max(1960, year - rangeYears)), to: year }),
    Relation: ({ year }) => ({ from: Year.make(Math.max(1960, year - rangeYears)), to: year }),
  })

const gdpPerPerson = IndicatorId.make("NY.GDP.PCAP.CD")
const lifeExpectancy = IndicatorId.make("SP.DYN.LE00.IN")

// A relation first plots its indicator against GDP per person, the usual
// measure of how rich a country is.
const against = (view: View) =>
  Match.value(view).pipe(
    Match.tag("Relation", (relation) => relation.against),
    Match.orElse(({ indicator }) => (indicator === gdpPerPerson ? lifeExpectancy : gdpPerPerson)),
  )

// Draws the View as another chart type, keeping its indicator, countries and
// transform where the new type takes them. A single-year chart shows the last
// of the years.
export const withChart = (view: View, chart: View["_tag"]): View => {
  const { indicator, countries } = view
  const { from, to } = span(view)
  const transform = transformOf(view)

  return Match.value(chart).pipe(
    Match.when("Trend", () =>
      withTransform(Trend.make({ indicator, countries, from, to }), transform),
    ),
    Match.when("Ranking", () =>
      withTransform(Ranking.make({ indicator, countries, year: to }), transform),
    ),
    Match.when("Change", () =>
      withTransform(Change.make({ indicator, countries, from, to }), transform),
    ),
    Match.when("Relation", () =>
      Relation.make({ indicator, against: against(view), countries, year: to }),
    ),
    Match.exhaustive,
  )
}
