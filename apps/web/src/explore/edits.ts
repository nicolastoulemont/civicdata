import {
  applies,
  Change,
  type Observation,
  type Code,
  type DimensionId,
  type Dimensions,
  IndicatorId,
  Ranking,
  Ratio,
  Relation,
  type Span,
  type Transform,
  transformOf,
  Trend,
  type View,
  Year,
} from "@openfacts/domain"
import { Match, Struct } from "effect"

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
    Trend: (trend) =>
      kept === undefined
        ? Trend.make(Struct.omit(trend, ["transform"]))
        : Trend.make({ ...trend, transform: kept }),
    Ranking: (ranking) =>
      kept === undefined || kept === "Index"
        ? Ranking.make(Struct.omit(ranking, ["transform"]))
        : Ranking.make({ ...ranking, transform: kept }),
    Change: (change) =>
      kept === undefined || kept === "Growth" || kept === "Index"
        ? Change.make(Struct.omit(change, ["transform"]))
        : Change.make({ ...change, transform: kept }),
    Relation: (relation) => relation,
  })
}

// Sets the value of every dimension the View picks, for an SDMX indicator.
export const withPicks = (view: View, dimensions: Dimensions) =>
  Match.valueTags(view, {
    Trend: (trend) => Trend.make({ ...trend, dimensions }),
    Ranking: (ranking) => Ranking.make({ ...ranking, dimensions }),
    Change: (change) => Change.make({ ...change, dimensions }),
    Relation: (relation) => Relation.make({ ...relation, dimensions }),
  })

// Picks one dimension's value, keeping the others.
export const withPick = (view: View, { id, code }: { id: DimensionId; code: Code }) =>
  withPicks(view, { ...view.dimensions, [id]: code })

// Switches indicator, keeping the transform only if the new one takes it. A
// relation given the indicator it is plotted against swaps its two axes. The
// old indicator's dimensions are its own, so none are kept.
export const withIndicator = (view: View, indicator: Picked) => {
  const transform = transformOf(view)

  const switched = Match.valueTags(view, {
    Trend: ({ countries, from, to }) =>
      Trend.make({ indicator: indicator.id, countries, from, to }),
    Ranking: (ranking) =>
      Ranking.make({
        ...Struct.omit(ranking, ["transform", "dimensions"]),
        indicator: indicator.id,
      }),
    Change: ({ countries, from, to }) =>
      Change.make({ indicator: indicator.id, countries, from, to }),
    Relation: (relation) =>
      Relation.make({
        ...Struct.omit(relation, ["dimensions"]),
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
// indicator swaps the two axes, which drops the dimensions it picked.
export const withAgainst = (relation: Relation, against: Picked) => {
  const kept = {
    ...Struct.pick(relation, ["span"]),
    against: against.id,
    countries: relation.countries,
    year: relation.year,
  }

  return against.id === relation.indicator
    ? Relation.make({ ...kept, indicator: relation.against })
    : Relation.make({
        ...Struct.pick(relation, ["dimensions"]),
        ...kept,
        indicator: relation.indicator,
      })
}

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
    Ranking: (ranking) =>
      ranking.span ?? {
        from: Year.make(Math.max(1960, ranking.year - rangeYears)),
        to: ranking.year,
      },
    Relation: (relation) =>
      relation.span ?? {
        from: Year.make(Math.max(1960, relation.year - rangeYears)),
        to: relation.year,
      },
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

// The `dimensions` field when the View picks some, else no field.
const picked = (dimensions: Dimensions | undefined) =>
  dimensions === undefined ? {} : { dimensions }

// The chart types a user picks from: a ranking drawn as bars or as a map.
export type Chart = View["_tag"] | "Map"

export const chartOf = (view: View): Chart =>
  Match.valueTags(view, {
    Trend: () => "Trend" as const,
    Ranking: (ranking) => ranking.as ?? "Ranking",
    Change: () => "Change" as const,
    Relation: () => "Relation" as const,
  })

// Draws the View as another chart type, keeping its indicator, the series it
// picks, its countries and its transform where the new type takes them. A
// single-year chart shows the last of the years. Bars and a map of the same
// ranking keep its years, over time or not.
export const withChart = (view: View, chart: Chart): View => {
  const { indicator, countries, dimensions } = view
  const { from, to } = span(view)
  const transform = transformOf(view)

  return Match.value(chart).pipe(
    Match.when("Trend", () =>
      withTransform(
        Trend.make({ ...picked(dimensions), indicator, countries, from, to }),
        transform,
      ),
    ),
    Match.when("Ranking", () =>
      Match.value(view).pipe(
        Match.tag("Ranking", (ranking) => Ranking.make(Struct.omit(ranking, ["as"]))),
        Match.orElse(() =>
          withTransform(
            Ranking.make({ ...picked(dimensions), indicator, countries, year: to }),
            transform,
          ),
        ),
      ),
    ),
    Match.when("Map", () =>
      Match.value(view).pipe(
        Match.tag("Ranking", (ranking) => Ranking.make({ ...ranking, as: "Map" })),
        Match.orElse(() =>
          withTransform(
            Ranking.make({ ...picked(dimensions), indicator, countries, year: to, as: "Map" }),
            transform,
          ),
        ),
      ),
    ),
    Match.when("Change", () =>
      withTransform(
        Change.make({ ...picked(dimensions), indicator, countries, from, to }),
        transform,
      ),
    ),
    Match.when("Relation", () =>
      Relation.make({
        ...picked(dimensions),
        indicator,
        against: against(view),
        countries,
        year: to,
      }),
    ),
    Match.exhaustive,
  )
}

// A chart that can move through a span of years.
export type Spanned = typeof Ranking.Type | typeof Relation.Type

// Sets a chart's span, moving its year inside the span when it lies outside.
export const withSpan = (view: Spanned, years: Span): Spanned => {
  const year = Year.make(Math.min(Math.max(view.year, years.from), years.to))

  return Match.valueTags(view, {
    Ranking: (ranking) => Ranking.make({ ...ranking, year, span: years }),
    Relation: (relation) => Relation.make({ ...relation, year, span: years }),
  })
}

// A chart of one year turned into one over time: from the first year every
// country with values has one, to the latest year with any, as `history`
// has them. Without values it stays one year.
export const overTime = (view: Spanned, history: ReadonlyArray<Observation>): Spanned => {
  const years = [...new Set(history.map((observation) => observation.year))]
  const covered = new Set(history.map((observation) => observation.country))
  const held = new Set(history.map(({ country, year }) => `${country} ${year}`))

  const shared = years.filter((year) =>
    [...covered].every((country) => held.has(`${country} ${year}`)),
  )

  if (years.length === 0) return view

  return withSpan(view, {
    from: Year.make(Math.min(...(shared.length === 0 ? years : shared))),
    to: Year.make(Math.max(...years)),
  })
}

// A chart over time turned into one of the year it shows.
export const oneYear = (view: Spanned): Spanned =>
  Match.valueTags(view, {
    Ranking: (ranking) => Ranking.make(Struct.omit(ranking, ["span"])),
    Relation: (relation) => Relation.make(Struct.omit(relation, ["span"])),
  })

// Sets the single year of a chart of one year.
export const withYear = (view: Spanned, year: Year): Spanned =>
  Match.valueTags(view, {
    Ranking: (ranking) => Ranking.make({ ...ranking, year }),
    Relation: (relation) => Relation.make({ ...relation, year }),
  })
