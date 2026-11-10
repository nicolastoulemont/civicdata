import {
  type Break,
  Country,
  type Covered,
  type Flag,
  inYear,
  type Observation,
  type Ranked,
  type ResolvedView,
  Year,
} from "@civicdata/domain"
import { Array as Arr, Match, Order, Schema } from "effect"

const Point = Schema.Struct({ year: Year, value: Schema.Finite })

type Point = typeof Point.Type

// How the source qualifies the charted values: each break in series, by
// country and year, and how many values are provisional or estimated. A break
// means the source changed how it measures from that year, so a jump there
// may be the method rather than the world.
const Flagged = Schema.Struct({
  breaks: Schema.Array(Schema.Struct({ country: Country, year: Year })),
  provisional: Schema.Int,
  estimated: Schema.Int,
})

// Where one line of a trend or a change starts, ends, and is lowest and
// highest.
const Line = Schema.Struct({
  country: Country,
  first: Point,
  last: Point,
  lowest: Point,
  highest: Point,
})

const Lines = Schema.TaggedStruct("Lines", {
  name: Schema.String,
  from: Year,
  to: Year,
  lines: Schema.Array(Line),
  missing: Schema.Array(Country),
  flagged: Flagged,
})

const Ranked = Schema.Array(Schema.Struct({ country: Country, value: Schema.Finite }))

// A ranking's values in its year, highest first. A ranking over time adds
// each country's values in the first and last years of its span, so the
// model can say how the comparison moved. `missing` lists the countries with
// no value in the year shown; `flagged` covers every year fetched, so a break
// in series inside the span is told.
const Bars = Schema.TaggedStruct("Bars", {
  name: Schema.String,
  year: Year,
  bars: Ranked,
  span: Schema.optionalKey(
    Schema.Struct({
      from: Schema.Struct({ year: Year, bars: Ranked }),
      to: Schema.Struct({ year: Year, bars: Ranked }),
    }),
  ),
  missing: Schema.Array(Country),
  flagged: Flagged,
})

// A relation's dots: each country's value of the indicator and of the one it
// is plotted against, named in `against`.
const Dots = Schema.TaggedStruct("Dots", {
  name: Schema.String,
  against: Schema.String,
  year: Year,
  dots: Schema.Array(
    Schema.Struct({ country: Country, value: Schema.Finite, against: Schema.Finite }),
  ),
  missing: Schema.Array(Country),
  flagged: Flagged,
})

// What show_chart tells the model about the values it charted, so it can
// write about it: the indicator's official name, which carries its unit,
// the years the chart covers, and a trend's or a change's lines, a ranking's
// bars, or a relation's dots. `missing` lists the countries the chart has no
// value for, and `flagged` how the source qualifies the indicator's values.
export const Summary = Schema.Union([Lines, Bars, Dots])

export type Summary = typeof Summary.Type

const byYear = Order.mapInput(Order.Number, (observation: Observation) => observation.year)
const byValue = Order.mapInput(Order.Number, (observation: Observation) => observation.value)

const marked = (observations: ReadonlyArray<Observation>, flag: Flag) =>
  observations.filter((observation) => observation.flags?.includes(flag) === true)

// A change passes its own breaks: it shows two years and drops those between.
const flaggedOf = (
  shown: ReadonlyArray<Observation>,
  breaks: ReadonlyArray<Break> = marked(shown, "Break").map(({ country, year }) => ({
    country,
    year,
  })),
) => ({
  breaks,
  provisional: marked(shown, "Provisional").length,
  estimated: marked(shown, "Estimated").length,
})

const pointOf = ({ year, value }: Observation): Point => ({ year, value })

const lineOf = (observations: Arr.NonEmptyReadonlyArray<Observation>) => ({
  country: observations[0].country,
  first: pointOf(Arr.min(observations, byYear)),
  last: pointOf(Arr.max(observations, byYear)),
  lowest: pointOf(Arr.min(observations, byValue)),
  highest: pointOf(Arr.max(observations, byValue)),
})

const lines = (
  { indicator, observations, missing }: ResolvedView,
  {
    from,
    to,
    breaks,
  }: { readonly from: Year; readonly to: Year; readonly breaks?: ReadonlyArray<Break> },
) =>
  Lines.make({
    name: indicator.name,
    from,
    to,
    lines: Object.values(Arr.groupBy(observations, (observation) => observation.country)).map(
      lineOf,
    ),
    missing,
    flagged: flaggedOf(observations, breaks),
  })

const ranked = (observations: ReadonlyArray<Observation>) =>
  Arr.sort(observations, Order.flip(byValue)).map(({ country, value }) => ({ country, value }))

const bars = (resolved: Ranked) => {
  const { view, indicator } = resolved
  const { observations, missing } = inYear(resolved, view.year)
  const at = (year: Year) => ({ year, bars: ranked(inYear(resolved, year).observations) })

  const shown = {
    name: indicator.name,
    year: view.year,
    bars: ranked(observations),
    missing,
    flagged: flaggedOf(resolved.observations),
  }

  return view.span === undefined
    ? Bars.make(shown)
    : Bars.make({ ...shown, span: { from: at(view.span.from), to: at(view.span.to) } })
}

// Only a relation holds the values it is plotted against, and only a change
// the breaks between its two years.
export const summarize = (resolved: ResolvedView): Summary => {
  if ("breaks" in resolved) return lines(resolved, { ...resolved.view, breaks: resolved.breaks })

  return "against" in resolved
    ? Dots.make({
        name: resolved.indicator.name,
        against: resolved.against.indicator.name,
        year: resolved.view.year,
        dots: resolved.observations.flatMap(({ country, value }) =>
          resolved.against.observations
            .filter((other) => other.country === country)
            .map((other) => ({ country, value, against: other.value })),
        ),
        missing: resolved.missing,
        flagged: flaggedOf(resolved.observations),
      })
    : Match.valueTags(resolved.view, {
        Trend: (trend) => lines(resolved, trend),
        Ranking: (view) => bars({ ...resolved, view }),
      })
}

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
