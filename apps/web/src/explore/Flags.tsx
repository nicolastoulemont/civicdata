import type { Country, Flag, ResolvedView } from "@openfacts/domain"
import { useTranslation } from "react-i18next"

import { useFormat } from "./useFormat.ts"

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

interface FlagsProps {
  resolved: ResolvedView
}

// Under the chart, the values its source qualifies, e.g. "Provisional:
// France 2024–2026, Greece 2026." Nothing when no value is flagged.
export const Flags = ({ resolved }: FlagsProps) => {
  const { flagLabels, countryName } = useFormat()

  const { t } = useTranslation("explore")

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
          {countryName(item.country)} {item.year} ({item.source}, {item.survey.code}:{" "}
          {item.survey.label}):{" "}
          {item.status?.code === "U" ? flagLabels.Unreliable : item.status?.label}
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
