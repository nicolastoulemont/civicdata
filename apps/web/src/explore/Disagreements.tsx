import type { ResolvedView } from "@openfacts/domain"
import { useTranslation } from "react-i18next"

import { page } from "./format.ts"
import { useFormat } from "./useFormat.ts"

// How many of a source's differing values the note spells out.
const shown = 4

interface DisagreementsProps {
  resolved: ResolvedView
}

// Under the chart, the other sources whose values for the same figure differ
// from the chart's, each cited with its dataset: "Eurostat, Unemployment by
// sex and age: France 2022 7.3 (chart: 7.9)". Nothing when they agree.
export const Disagreements = ({ resolved }: DisagreementsProps) => {
  const { countryName, formatValue } = useFormat()

  const { t } = useTranslation("explore")

  if (resolved.disagreements.length === 0) return null

  const ours = new Map(
    resolved.observations.map(({ country, year, value }) => [`${country}:${year}`, value]),
  )

  return (
    <section
      aria-label={t(($) => $["Other sources"])}
      className="space-y-1 text-sm text-muted-foreground"
    >
      <p className="font-medium text-foreground">
        {t(($) => $["Other sources give other values"])}
      </p>
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
              .map(({ country, year, value }) =>
                t(($) => $["{{value1}} {{year}} {{value3}} (chart: {{value4}})"], {
                  value1: countryName(country),
                  year: year,
                  value3: formatValue(value),
                  value4: formatValue(ours.get(`${country}:${year}`) ?? Number.NaN),
                }),
              )
              .join("; ")}
            {observations.length > shown
              ? t(($) => $["; and {{value1}} more"], { value1: observations.length - shown })
              : ""}
            .
          </li>
        ))}
      </ul>
    </section>
  )
}
