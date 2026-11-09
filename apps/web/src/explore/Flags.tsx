import type { Country, Flag, ResolvedView } from "@civicdata/domain"

import { countryName, flagLabels } from "./format.ts"

const order: ReadonlyArray<Flag> = ["Provisional", "Estimated", "Break"]

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
  const groups = order.flatMap((flag) => {
    const years = new Map<Country, Array<number>>()

    for (const { country, year, flags } of resolved.observations)
      if (flags?.includes(flag) === true) years.set(country, [...(years.get(country) ?? []), year])

    return years.size === 0 ? [] : [{ flag, years: [...years] }]
  })

  return groups.length === 0 ? null : (
    <ul aria-label="Flagged values" className="space-y-1 text-sm text-muted-foreground">
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
