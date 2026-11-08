import {
  applies,
  type IndicatorId,
  Ranking,
  type Transform,
  Trend,
  type View,
  Year,
} from "@civicdata/domain"
import { Match } from "effect"

// Edits a user makes to a View through the page's controls. Each returns a
// valid View: the `make` constructors check it.

// Sets or clears the transform. A ranking has no first year to index to, so
// "Index" leaves a ranking untransformed.
export const withTransform = (view: View, transform: Transform | undefined) =>
  Match.valueTags(view, {
    Trend: ({ indicator, countries, from, to }) =>
      transform === undefined
        ? Trend.make({ indicator, countries, from, to })
        : Trend.make({ indicator, countries, from, to, transform }),
    Ranking: ({ indicator, countries, year }) =>
      transform === undefined || transform === "Index"
        ? Ranking.make({ indicator, countries, year })
        : Ranking.make({ indicator, countries, year, transform }),
  })

// Switches indicator, keeping the transform only if the new one takes it.
export const withIndicator = (
  view: View,
  indicator: { readonly id: IndicatorId; readonly name: string },
) => {
  const switched = Match.valueTags(view, {
    Trend: (trend) => Trend.make({ ...trend, indicator: indicator.id }),
    Ranking: (ranking) => Ranking.make({ ...ranking, indicator: indicator.id }),
  })

  return switched.transform === undefined || applies(switched.transform, indicator.name)
    ? switched
    : withTransform(switched, undefined)
}

export const withCountries = (view: View, countries: View["countries"]) =>
  Match.valueTags(view, {
    Trend: (trend) => Trend.make({ ...trend, countries }),
    Ranking: (ranking) => Ranking.make({ ...ranking, countries }),
  })

// How far back a ranking turned into a trend looks.
const trendYears = 20

// A trend becomes a ranking of its last year.
export const asRanking = (view: View) =>
  Match.valueTags(view, {
    Trend: ({ indicator, countries, to, transform }) =>
      withTransform(Ranking.make({ indicator, countries, year: to }), transform),
    Ranking: (ranking) => ranking,
  })

// A ranking becomes the trend of the years leading to it, from 1960 at the earliest.
export const asTrend = (view: View) =>
  Match.valueTags(view, {
    Trend: (trend) => trend,
    Ranking: ({ indicator, countries, year, transform }) =>
      withTransform(
        Trend.make({
          indicator,
          countries,
          from: Year.make(Math.max(1960, year - trendYears)),
          to: year,
        }),
        transform,
      ),
  })
