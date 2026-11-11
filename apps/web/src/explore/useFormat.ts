import {
  countries,
  type Country,
  type Direction,
  type Flag,
  type IndicatorId,
  type ResolvedView,
  type Source,
  transformOf,
  type View,
} from "@civicdata/domain"
import { Match } from "effect"
import type { TFunction } from "i18next"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import * as original from "./format.ts"

const places = new Map(countries.map((country) => [country.code, country]))

// The source's English country names also identify economies without an ISO
// region. Intl receives alpha-2 codes, never an alpha-3 code or an English name.
const formats = (locale: string) => {
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 })
  const full = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
  const names = new Intl.DisplayNames(locale, { type: "region", fallback: "none" })

  return {
    countryName: (country: Country) => {
      const place = places.get(country)

      return locale === "en-US" || place === undefined
        ? original.countryName(country)
        : (names.of(place.alpha2) ?? place.name)
    },
    formatCompact: (value: number) => compact.format(value),
    formatValue: (value: number) => full.format(value),
    retrieved: (resolved: ResolvedView) => original.retrieved(resolved, locale),
  }
}

const formatter = (t: TFunction<"explore">, locale: string) => {
  const period = (view: View) =>
    Match.valueTags(view, {
      Trend: ({ from, to }) => `${from}–${to}`,
      Change: ({ from, to }) => t(($) => $["{{from}} and {{to}}"], { from, to }),
      Ranking: ({ year, span }) => (span === undefined ? `${year}` : `${span.from}–${span.to}`),
      Relation: ({ year, span }) => (span === undefined ? `${year}` : `${span.from}–${span.to}`),
    })

  const transformLabel = (view: View, known: ReadonlyMap<IndicatorId, string>) =>
    Match.value(transformOf(view)).pipe(
      Match.when("PerPerson", () => t(($) => $["per person"])),
      Match.when("Growth", () => t(($) => $["annual % change"])),
      Match.when("Index", () =>
        Match.value(view).pipe(
          Match.tag("Trend", (trend) => t(($) => $["index, {{year}} = 100"], { year: trend.from })),
          Match.orElse(() => undefined),
        ),
      ),
      Match.when({ _tag: "Ratio" }, ({ per }) =>
        t(($) => $["per {{indicator}}"], { indicator: known.get(per) ?? per }),
      ),
      Match.orElse(() => undefined),
    )

  const subject = (view: View, known: ReadonlyMap<IndicatorId, string>) =>
    "against" in view
      ? t(($) => $["{{indicator}} against {{against}}"], {
          indicator: known.get(view.indicator) ?? view.indicator,
          against: known.get(view.against) ?? view.against,
        })
      : (known.get(view.indicator) ?? view.indicator)

  const named = (source: Source) =>
    source === "Eurostat" ? source : t(($) => $["The {{source}}"], { source })

  const flagLabels: Record<Flag, string> = {
    Provisional: t(($) => $["Provisional"]),
    Estimated: t(($) => $["Estimated"]),
    Break: t(($) => $["Break in series"]),
  }

  const numeric = formats(locale)

  const attribution = (resolved: ResolvedView) =>
    t(($) => $["Source: {{sources}}. Retrieved {{date}}."], {
      sources: original.credits(resolved),
      date: numeric.retrieved(resolved),
    })

  const phrase = (direction: Direction) =>
    Match.value(direction).pipe(
      Match.when("Higher", () => t(($) => $["Higher is better"])),
      Match.when("Lower", () => t(($) => $["Lower is better"])),
      Match.when("Neutral", () => undefined),
      Match.exhaustive,
    )

  return {
    phrase,
    ...numeric,
    period,
    transformLabel,
    subject,
    named,
    flagLabels,
    attribution,
    locale,
  }
}

export const useFormat = () => {
  const { t, i18n } = useTranslation("explore")

  return useMemo(() => formatter(t, i18n.language), [t, i18n.language])
}
