import { Country, IndicatorId, Ranking, Trend, type View, Year } from "@civicdata/domain"
import { Match, Schema } from "effect"

// The View as readable URL parameters:
// ?chart=trend&indicator=SP.POP.TOTL&countries=FRA,DEU&from=2000&to=2022
const Search = Schema.Union([
  Schema.Struct({
    chart: Schema.Literal("trend"),
    indicator: IndicatorId,
    countries: Schema.String,
    from: Year,
    to: Year,
  }),
  Schema.Struct({
    chart: Schema.Literal("ranking"),
    indicator: IndicatorId,
    countries: Schema.String,
    year: Year,
  }),
])

export type Search = typeof Search.Encoded

const countryList = Schema.decodeUnknownSync(Schema.NonEmptyArray(Country))

// Throws on a link that does not describe a valid View, which the route turns
// into its error page. `Trend.make` and `Ranking.make` reject duplicate
// countries, and `Trend.make` rejects years that run backwards.
export const toView = (search: Search): View =>
  Match.value(Schema.decodeSync(Search)(search)).pipe(
    Match.when({ chart: "trend" }, ({ indicator, countries, from, to }) =>
      Trend.make({ indicator, countries: countryList(countries.split(",")), from, to }),
    ),
    Match.when({ chart: "ranking" }, ({ indicator, countries, year }) =>
      Ranking.make({ indicator, countries: countryList(countries.split(",")), year }),
    ),
    Match.exhaustive,
  )

export const toSearch = (view: View): Search =>
  Match.valueTags(view, {
    Trend: ({ indicator, countries, from, to }) => ({
      chart: "trend" as const,
      indicator,
      countries: countries.join(","),
      from,
      to,
    }),
    Ranking: ({ indicator, countries, year }) => ({
      chart: "ranking" as const,
      indicator,
      countries: countries.join(","),
      year,
    }),
  })
