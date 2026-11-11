import { Array as Arr, Predicate, Schema, Struct } from "effect"

import { Country } from "./Country.ts"
import { Dimension } from "./Dimension.ts"
import { Direction } from "./Direction.ts"
import ilostat from "./ilostat.json" with { type: "json" }
import { Indicator, IndicatorId } from "./Indicator.ts"
import { SeriesKey } from "./SeriesKey.ts"
import { Source } from "./Source.ts"
import { Change, Ranking, Relation, Trend, Year } from "./View.ts"

// How a source qualifies a value: provisional until its final release,
// estimated rather than measured, or the first after a break in series, when
// the source changed how it measures. Unreliable remains distinct from an estimate.
const Flag = Schema.Literals(["Provisional", "Estimated", "Break", "Unreliable"])

export type Flag = typeof Flag.Type

// One value of an indicator, as the source published it or after a transform.
export const Observation = Schema.Struct({
  country: Country,
  year: Year,
  value: Schema.Finite,
  flags: Schema.optionalKey(Schema.NonEmptyArray(Flag)),
})

export interface Observation extends Schema.Schema.Type<typeof Observation> {}

// Publisher evidence belongs to a series and country-year, even without a number.
const place = {
  country: Country,
  year: Year,
  missing: Schema.Boolean,
  exclusion: Schema.optionalKey(Schema.Literals(["ReferencePeriod", "Geography"])),
}

const IloQualification = Schema.Struct({
  source: Schema.Literal("ILOSTAT"),
  survey: Schema.Struct({ code: Schema.NonEmptyString, label: Schema.NonEmptyString }),
  series: SeriesKey,
  ...place,
  status: Schema.optionalKey(
    Schema.Struct({
      code: Schema.Literals(["B", "U"]),
      label: Schema.Literals(["Break in series", "Unreliable"]),
    }).check(
      Schema.makeFilter(
        ({ code, label }) =>
          (code === "B" && label === "Break in series") || (code === "U" && label === "Unreliable"),
      ),
    ),
  ),
  notes: Schema.Array(
    Schema.Struct({
      category: Schema.Literals(["Indicator", "Source", "Classification"]),
      code: Schema.NonEmptyString,
      label: Schema.NonEmptyString,
    }),
  ),
}).check(
  Schema.makeFilter(
    (item) =>
      item.series.indicator === "ILOSTAT:SDG_B552_NOC_RT_A" &&
      item.notes.every((note) => {
        const dictionaries = {
          Source: ilostat.note_source,
          Indicator: ilostat.note_indicator,
          Classification: {},
        }

        const dictionary = dictionaries[note.category]

        return Object.entries(dictionary).some(
          ([code, label]) => code === note.code && label === note.label,
        )
      }),
  ),
)

// FAO's archive has flags and free-text notes, but no ILO survey identity.
const FaoQualification = Schema.Struct({
  source: Schema.Literal("FAOSTAT"),
  series: SeriesKey,
  ...place,
  status: Schema.optionalKey(
    Schema.Struct({ code: Schema.NonEmptyString, label: Schema.NonEmptyString }),
  ),
  notes: Schema.Array(
    Schema.Struct({
      category: Schema.Literal("Note"),
      code: Schema.Literal("Note"),
      label: Schema.NonEmptyString,
    }),
  ),
}).check(Schema.makeFilter((item) => item.series.indicator === "FAOSTAT:AE"))

export const Qualification = Schema.Union([IloQualification, FaoQualification])

export type Qualification = typeof Qualification.Type

// A country's first value after a break in series.
const Break = Schema.Struct({ country: Country, year: Year })

export type Break = typeof Break.Type

// One series fetched to draw the chart, shown next to it. A transformed chart
// lists every series it was computed from, e.g. GDP and population.
const Provenance = Schema.Struct({
  indicator: IndicatorId,
  name: Schema.NonEmptyString,
  source: Source,
  dataset: Schema.NonEmptyString,
  url: Schema.String,
  retrievedAt: Schema.DateTimeUtc,
})

// Another source's values for what the chart shows, where they differ from
// the chart's by more than rounding. `source` is the series they came from.
const Disagreement = Schema.Struct({
  source: Provenance,
  observations: Schema.NonEmptyArray(Observation),
})

// What every resolved View holds: its indicator's values after the
// transform. `title` heads the chart: the indicator's plain-language title, or
// its official name when it has none; `indicator` keeps the official name.
// `missing` lists the requested countries with no value, so the chart can say
// so instead of dropping them. `dimensions` lists what else an SDMX
// indicator's series differ by, with the values the View can pick; it is
// empty for the World Bank, whose indicators are single series.
// `disagreements` lists the other sources whose values for the same figure
// differ. `direction` says which way the chart's values are better, from its
// indicator and transform; maps and changes colour by it.
const fields = {
  title: Schema.NonEmptyString,
  indicator: Indicator,
  observations: Schema.Array(Observation),
  qualifications: Schema.optionalKey(Schema.Array(Qualification)),
  missing: Schema.Array(Country),
  dimensions: Schema.Array(Dimension),
  disagreements: Schema.Array(Disagreement),
  sources: Schema.NonEmptyArray(Provenance),
  direction: Direction,
}

// A Trend or Ranking, with the data behind it.
const Single = Schema.Struct({ view: Schema.Union([Trend, Ranking]), ...fields })

export interface Ranked extends Schema.Schema.Type<typeof Single> {
  readonly view: typeof Ranking.Type
}

export const isRanked = (resolved: ResolvedView): resolved is Ranked =>
  Predicate.isTagged(resolved.view, "Ranking")

// The values of one year, and other sources' disagreements that year.
const at = <O extends { readonly year: Year }>(observations: ReadonlyArray<O>, year: Year) =>
  observations.filter((observation) => observation.year === year)

const disagreementsIn = (disagreements: Ranked["disagreements"], year: Year) =>
  disagreements.flatMap((disagreement) => {
    const kept = at(disagreement.observations, year)

    return Arr.isArrayNonEmpty(kept) ? [{ ...disagreement, observations: kept }] : []
  })

const held = (shown: ReadonlyArray<Observation>, country: Country) =>
  shown.some((observation) => observation.country === country)

// A chart over time as the static chart of one year of its span: that year's
// values and other sources' disagreements, with the countries that have no
// value that year missing; for a relation, no value of either indicator.
export function inYear(resolved: Ranked, year: Year): Ranked
export function inYear(resolved: Related, year: Year): Related
export function inYear(resolved: Ranked | Related, year: Year): Ranked | Related
export function inYear(resolved: Ranked | Related, year: Year): Ranked | Related {
  const observations = at(resolved.observations, year)
  const disagreements = disagreementsIn(resolved.disagreements, year)

  if (!("against" in resolved)) {
    return {
      ...resolved,
      view: Ranking.make({ ...Struct.omit(resolved.view, ["span"]), year }),
      observations,
      qualifications: (resolved.qualifications ?? []).filter((item) => item.year === year),
      missing: resolved.view.countries.filter((country) => !held(observations, country)),
      disagreements,
    }
  }

  const against = at(resolved.against.observations, year)

  return {
    ...resolved,
    view: Relation.make({ ...Struct.omit(resolved.view, ["span"]), year }),
    observations,
    qualifications: (resolved.qualifications ?? []).filter((item) => item.year === year),
    against: { ...resolved.against, observations: against },
    missing: resolved.view.countries.filter(
      (country) => !held(observations, country) || !held(against, country),
    ),
    disagreements,
  }
}

// A Change shows its two years only. `breaks` keeps each break in series in
// the years it spans, which its observations drop.
const Stepped = Schema.Struct({ view: Change, ...fields, breaks: Schema.Array(Break) })

// A Relation also holds the values of the indicator it is plotted against.
// A country is missing unless it has a value for both.
const Paired = Schema.Struct({
  view: Relation,
  ...fields,
  against: Schema.Struct({
    title: Schema.NonEmptyString,
    indicator: Indicator,
    observations: Schema.Array(Observation),
  }),
})

export interface Related extends Schema.Schema.Type<typeof Paired> {}

export const ResolvedView = Schema.Union([Single, Stepped, Paired])

export type ResolvedView = typeof ResolvedView.Type
