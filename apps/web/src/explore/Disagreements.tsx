import type { ResolvedView } from "@civicdata/domain"

import { countryName, formatValue, page } from "./format.ts"

// How many of a source's differing values the note spells out.
const shown = 4

interface DisagreementsProps {
  resolved: ResolvedView
}

// Under the chart, the other sources whose values for the same figure differ
// from the chart's, each cited with its dataset: "Eurostat, Unemployment by
// sex and age: France 2022 7.3 (chart: 7.9)". Nothing when they agree.
export const Disagreements = ({ resolved }: DisagreementsProps) => {
  if (resolved.disagreements.length === 0) return null

  const ours = new Map(
    resolved.observations.map(({ country, year, value }) => [`${country}:${year}`, value]),
  )

  return (
    <section aria-label="Other sources" className="space-y-1 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">Other sources give other values</p>
      <ul className="space-y-1">
        {resolved.disagreements.map(({ source, observations }) => (
          <li key={source.indicator}>
            {source.source},{" "}
            <a className="underline underline-offset-4" href={page(source)}>
              {source.dataset}
            </a>
            :{" "}
            {observations
              .slice(0, shown)
              .map(
                ({ country, year, value }) =>
                  `${countryName(country)} ${year} ${formatValue(value)} (chart: ${formatValue(ours.get(`${country}:${year}`) ?? Number.NaN)})`,
              )
              .join("; ")}
            {observations.length > shown ? `; and ${observations.length - shown} more` : ""}.
          </li>
        ))}
      </ul>
    </section>
  )
}
