import type { Country, Flag, Qualification, ResolvedView } from "@openfacts/domain"
import { useTranslation } from "react-i18next"

import { useFormat } from "./useFormat.ts"

const estimated = (item: Qualification): item is Extract<Qualification, { source: "V-Dem" }> =>
  item.source === "V-Dem"

const who = (item: Qualification): item is Extract<Qualification, { source: "WHO" }> =>
  item.source === "WHO"

const unreliable = (item: Qualification) => item.source === "ILOSTAT" && item.status?.code === "U"

const publisher = (item: Qualification) =>
  item.source === "ILOSTAT"
    ? `${item.source}, ${item.survey.code}: ${item.survey.label}`
    : item.source

const order: ReadonlyArray<Flag> = ["Provisional", "Estimated", "Break", "Unreliable"]

// Consecutive years as ranges: [2019, 2020, 2021, 2024] → "2019–2021, 2024".
const spans = (years: ReadonlyArray<number>) =>
  years
    .toSorted((left, right) => left - right)
    .reduce<Array<[number, number]>>((runs, year) => {
      const last = runs.at(-1)

      if (last !== undefined && last[1] === year - 1) last[1] = year
      else runs.push([year, year])

      return runs
    }, [])
    .map(([from, to]) => (from === to ? `${from}` : `${from}–${to}`))
    .join(", ")

interface WhoBoundsProps {
  item: Extract<Qualification, { source: "WHO" }>
}

const WhoBounds = ({ item }: WhoBoundsProps) => {
  const { t, i18n } = useTranslation("explore")
  const number = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 3 })

  return (
    <span>
      {t(
        ($) =>
          $["WHO estimate {{estimate}}; 95% uncertainty bounds {{lower}}–{{upper}} ({{version}})."],
        {
          estimate:
            item.estimate === null ? t(($) => $["Missing value"]) : number.format(item.estimate),
          lower: item.lower === null ? t(($) => $["Missing value"]) : number.format(item.lower),
          upper: item.upper === null ? t(($) => $["Missing value"]) : number.format(item.upper),
          version: item.version,
        },
      )}
    </span>
  )
}

interface FlagsProps {
  resolved: ResolvedView
}

// Under the chart, the values its source qualifies, e.g. "Provisional:
// France 2024–2026, Greece 2026." Nothing when no value is flagged.
export const Flags = ({ resolved }: FlagsProps) => {
  const { flagLabels, countryName } = useFormat()

  const { t, i18n } = useTranslation("explore")
  const number = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 3 })

  const groups = order.flatMap((flag) => {
    const years = new Map<Country, Array<number>>()

    for (const { country, year, flags } of resolved.observations)
      if (flags?.includes(flag) === true) years.set(country, [...(years.get(country) ?? []), year])

    return years.size === 0 ? [] : [{ flag, years: [...years] }]
  })

  const exclusionLabels = {
    ReferencePeriod: t(($) => $["Excluded reference period"]),
    Geography: t(($) => $["Excluded geography"]),
  }

  const qualifications = resolved.qualifications ?? []

  return groups.length === 0 && qualifications.length === 0 ? null : (
    <ul
      aria-label={t(($) => $["Flagged values"])}
      className="space-y-1 text-sm text-muted-foreground"
    >
      {qualifications.map((item) => (
        <li key={`${JSON.stringify(item.series)}:${item.country}:${item.year}`}>
          {countryName(item.country)} {item.year} ({publisher(item)}
          ):{" "}
          {unreliable(item)
            ? flagLabels.Unreliable
            : item.status !== undefined && `${item.status.code}: ${item.status.label}`}
          {estimated(item) && item.interval !== null && item.estimate !== null && (
            <span>
              {t(
                ($) =>
                  $["Estimate {{estimate}}; 68% HPD interval {{lower}}–{{upper}} ({{version}})"],
                {
                  estimate: number.format(item.estimate),
                  lower: number.format(item.interval.lower),
                  upper: number.format(item.interval.upper),
                  version: item.version.split("/")[0],
                },
              )}
            </span>
          )}
          {who(item) && <WhoBounds item={item} />}
          {item.missing && <span>{t(($) => $["Missing value"])}</span>}
          {item.exclusion !== undefined && <span>{exclusionLabels[item.exclusion]}</span>}
          {item.notes.map((note) => ` · ${note.category} ${note.code}: ${note.label}`).join("")}
        </li>
      ))}
      {groups.map(({ flag, years }) => (
        <li key={flag}>
          <span className="font-medium text-foreground">{flagLabels[flag]}:</span>{" "}
          {years
            .map(([country, flagged]) => `${countryName(country)} ${spans(flagged)}`)
            .join("; ")}
        </li>
      ))}
    </ul>
  )
}
