import {
  Change,
  Country,
  IndicatorId,
  Ranking,
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
const Search = Schema.Union([
  Schema.Struct({
    chart: Schema.Literal("trend"),
    indicator: IndicatorId,
    countries: Schema.String,
    from: Year,
    to: Year,
    transform: Schema.optionalKey(Schema.Literals(["per-person", "growth", "index"])),
  }),
  Schema.Struct({
    chart: Schema.Literal("ranking"),
    indicator: IndicatorId,
    countries: Schema.String,
    year: Year,
    transform: Schema.optionalKey(Schema.Literals(["per-person", "growth"])),
  }),
  Schema.Struct({
    chart: Schema.Literal("change"),
    indicator: IndicatorId,
    countries: Schema.String,
    from: Year,
    to: Year,
    transform: Schema.optionalKey(Schema.Literal("per-person")),
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

// Adds the transform parameter only when the View has a transform.
const withParam = <S extends object>(search: S, transform: Transform | undefined) =>
  transform === undefined ? search : { ...search, transform: toParam[transform] }

export type Search = typeof Search.Encoded

const countryList = Schema.decodeUnknownSync(Schema.NonEmptyArray(Country))

// Throws on a link that does not describe a valid View, which the route turns
// into its error page. The `make` constructors reject duplicate countries,
// years that run backwards and a relation of an indicator to itself.
export const toView = (search: Search): View =>
  Match.value(Schema.decodeSync(Search)(search)).pipe(
    Match.when({ chart: "trend" }, ({ indicator, countries, from, to, transform }) =>
      withTransform(
        Trend.make({ indicator, countries: countryList(countries.split(",")), from, to }),
        transform === undefined ? undefined : fromParam[transform],
      ),
    ),
    Match.when({ chart: "ranking" }, ({ indicator, countries, year, transform }) =>
      withTransform(
        Ranking.make({ indicator, countries: countryList(countries.split(",")), year }),
        transform === undefined ? undefined : fromParam[transform],
      ),
    ),
    Match.when({ chart: "change" }, ({ indicator, countries, from, to, transform }) =>
      withTransform(
        Change.make({ indicator, countries: countryList(countries.split(",")), from, to }),
        transform === undefined ? undefined : fromParam[transform],
      ),
    ),
    Match.when({ chart: "relation" }, ({ indicator, against, countries, year }) =>
      Relation.make({ indicator, against, countries: countryList(countries.split(",")), year }),
    ),
    Match.exhaustive,
  )

export const toSearch = (view: View): Search =>
  Match.valueTags(view, {
    Trend: ({ indicator, countries, from, to, transform }) =>
      withParam(
        { chart: "trend" as const, indicator, countries: countries.join(","), from, to },
        transform,
      ),
    Ranking: ({ indicator, countries, year, transform }) =>
      withParam(
        { chart: "ranking" as const, indicator, countries: countries.join(","), year },
        transform,
      ),
    Change: ({ indicator, countries, from, to, transform }) =>
      withParam(
        { chart: "change" as const, indicator, countries: countries.join(","), from, to },
        transform,
      ),
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
