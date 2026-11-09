import {
  Change,
  Country,
  IndicatorId,
  Ranking,
  Ratio,
  Relation,
  type Transform,
  Trend,
  type View,
  Year,
} from "@civicdata/domain"
import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router"
import { Match, Schema } from "effect"

import { withTransform } from "./edits.ts"

// The View as readable URL parameters:
// ?chart=trend&indicator=SP.POP.TOTL&countries=FRA,DEU&from=2000&to=2022&transform=index
// ?chart=relation&indicator=SP.DYN.LE00.IN&against=NY.GDP.PCAP.CD&countries=FRA,DEU&year=2022
// A ratio names the indicator it divides by: &transform=ratio&per=NY.GDP.MKTP.CD
const Search = Schema.Union([
  Schema.Struct({
    chart: Schema.Literal("trend"),
    indicator: IndicatorId,
    countries: Schema.String,
    from: Year,
    to: Year,
    transform: Schema.optionalKey(Schema.Literals(["per-person", "growth", "index", "ratio"])),
    per: Schema.optionalKey(IndicatorId),
  }),
  Schema.Struct({
    chart: Schema.Literal("ranking"),
    indicator: IndicatorId,
    countries: Schema.String,
    year: Year,
    transform: Schema.optionalKey(Schema.Literals(["per-person", "growth", "ratio"])),
    per: Schema.optionalKey(IndicatorId),
  }),
  Schema.Struct({
    chart: Schema.Literal("change"),
    indicator: IndicatorId,
    countries: Schema.String,
    from: Year,
    to: Year,
    transform: Schema.optionalKey(Schema.Literals(["per-person", "ratio"])),
    per: Schema.optionalKey(IndicatorId),
  }),
  Schema.Struct({
    chart: Schema.Literal("relation"),
    indicator: IndicatorId,
    against: IndicatorId,
    countries: Schema.String,
    year: Year,
  }),
])

const fromParam = { "per-person": "PerPerson", growth: "Growth", index: "Index" } as const
const toParam = { PerPerson: "per-person", Growth: "growth", Index: "index" } as const

const isRatio = Schema.is(Ratio)

type Params<P> = { readonly transform?: P; readonly per?: IndicatorId }

// The transform as link parameters, none without one. Each chart type takes
// only the parameters for its own transforms.
function transformParams(transform: Change["transform"]): Params<"per-person" | "ratio">
function transformParams(
  transform: (typeof Ranking.Type)["transform"],
): Params<"per-person" | "growth" | "ratio">
function transformParams(
  transform: Transform | undefined,
): Params<"per-person" | "growth" | "index" | "ratio">
function transformParams(transform: Transform | undefined) {
  if (transform === undefined) return {}

  if (isRatio(transform)) return { transform: "ratio", per: transform.per }

  return { transform: toParam[transform] }
}

// The transform a link names. Throws when a ratio lacks the indicator it
// divides by, or another transform names one.
const transformOfParams = ({
  transform,
  per,
}: {
  readonly transform?: keyof typeof fromParam | "ratio"
  readonly per?: IndicatorId
}): Transform | undefined => {
  if (transform === "ratio" && per !== undefined) return Ratio.make({ per })

  if (transform === "ratio" || per !== undefined) throw new Error("per goes with transform=ratio")

  return transform === undefined ? undefined : fromParam[transform]
}

export type Search = typeof Search.Encoded

const countryList = Schema.decodeUnknownSync(Schema.NonEmptyArray(Country))

// Throws on a link that does not describe a valid View, which the route turns
// into its error page. The `make` constructors reject duplicate countries,
// years that run backwards and a relation of an indicator to itself.
export const toView = (search: Search): View =>
  Match.value(Schema.decodeSync(Search)(search)).pipe(
    Match.when({ chart: "trend" }, ({ indicator, countries, from, to, ...params }) =>
      withTransform(
        Trend.make({ indicator, countries: countryList(countries.split(",")), from, to }),
        transformOfParams(params),
      ),
    ),
    Match.when({ chart: "ranking" }, ({ indicator, countries, year, ...params }) =>
      withTransform(
        Ranking.make({ indicator, countries: countryList(countries.split(",")), year }),
        transformOfParams(params),
      ),
    ),
    Match.when({ chart: "change" }, ({ indicator, countries, from, to, ...params }) =>
      withTransform(
        Change.make({ indicator, countries: countryList(countries.split(",")), from, to }),
        transformOfParams(params),
      ),
    ),
    Match.when({ chart: "relation" }, ({ indicator, against, countries, year }) =>
      Relation.make({ indicator, against, countries: countryList(countries.split(",")), year }),
    ),
    Match.exhaustive,
  )

export const toSearch = (view: View): Search =>
  Match.valueTags(view, {
    Trend: ({ indicator, countries, from, to, transform }) => ({
      chart: "trend" as const,
      indicator,
      countries: countries.join(","),
      from,
      to,
      ...transformParams(transform),
    }),
    Ranking: ({ indicator, countries, year, transform }) => ({
      chart: "ranking" as const,
      indicator,
      countries: countries.join(","),
      year,
      ...transformParams(transform),
    }),
    Change: ({ indicator, countries, from, to, transform }) => ({
      chart: "change" as const,
      indicator,
      countries: countries.join(","),
      from,
      to,
      ...transformParams(transform),
    }),
    Relation: ({ indicator, against, countries, year }) => ({
      chart: "relation" as const,
      indicator,
      against,
      countries: countries.join(","),
      year,
    }),
  })

// The View in a URL's query string, read the way the router reads /explore's.
// Throws like toView.
export const fromUrl = (url: URL) =>
  toView(Schema.decodeUnknownSync(Schema.toEncoded(Search))(defaultParseSearch(url.search)))

// The query string for a View, "?chart=...", written the way the router writes it.
export const toQuery = (view: View) => defaultStringifySearch(toSearch(view))
