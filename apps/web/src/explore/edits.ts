import { type IndicatorId, Ranking, Trend, type View, Year } from "@civicdata/domain"
import { Match } from "effect"

// Edits a user makes to a View through the page's controls. Each returns a
// valid View: the `make` constructors check it.

export const withIndicator = (view: View, indicator: IndicatorId) =>
  Match.valueTags(view, {
    Trend: (trend) => Trend.make({ ...trend, indicator }),
    Ranking: (ranking) => Ranking.make({ ...ranking, indicator }),
  })

export const withCountries = (view: View, countries: View["countries"]) =>
  Match.valueTags(view, {
    Trend: ({ indicator, from, to }) => Trend.make({ indicator, countries, from, to }),
    Ranking: ({ indicator, year }) => Ranking.make({ indicator, countries, year }),
  })

// How far back a ranking turned into a trend looks.
const trendYears = 20

// A trend becomes a ranking of its last year.
export const asRanking = (view: View) =>
  Match.valueTags(view, {
    Trend: ({ indicator, countries, to }) => Ranking.make({ indicator, countries, year: to }),
    Ranking: (ranking) => ranking,
  })

// A ranking becomes the trend of the years leading to it, from 1960 at the earliest.
export const asTrend = (view: View) =>
  Match.valueTags(view, {
    Trend: (trend) => trend,
    Ranking: ({ indicator, countries, year }) =>
      Trend.make({
        indicator,
        countries,
        from: Year.make(Math.max(1960, year - trendYears)),
        to: year,
      }),
  })
