import {
  Country,
  IndicatorId,
  Ranking,
  type Transform,
  Trend,
  type View,
  Year,
} from "@civicdata/domain"
import { Match, Schema } from "effect"

import { withTransform } from "./edits.ts"

// The View as readable URL parameters:
// ?chart=trend&indicator=SP.POP.TOTL&countries=FRA,DEU&from=2000&to=2022&transform=index
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
])

const fromUrl = { "per-person": "PerPerson", growth: "Growth", index: "Index" } as const
const toUrl = { PerPerson: "per-person", Growth: "growth", Index: "index" } as const

// Adds the transform parameter only when the View has a transform.
const withParam = <S extends object>(search: S, transform: Transform | undefined) =>
  transform === undefined ? search : { ...search, transform: toUrl[transform] }

export type Search = typeof Search.Encoded

const countryList = Schema.decodeUnknownSync(Schema.NonEmptyArray(Country))

// Throws on a link that does not describe a valid View, which the route turns
// into its error page. `Trend.make` and `Ranking.make` reject duplicate
// countries, and `Trend.make` rejects years that run backwards.
export const toView = (search: Search): View =>
  Match.value(Schema.decodeSync(Search)(search)).pipe(
    Match.when({ chart: "trend" }, ({ indicator, countries, from, to, transform }) =>
      withTransform(
        Trend.make({ indicator, countries: countryList(countries.split(",")), from, to }),
        transform === undefined ? undefined : fromUrl[transform],
      ),
    ),
    Match.when({ chart: "ranking" }, ({ indicator, countries, year, transform }) =>
      withTransform(
        Ranking.make({ indicator, countries: countryList(countries.split(",")), year }),
        transform === undefined ? undefined : fromUrl[transform],
      ),
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
  })
