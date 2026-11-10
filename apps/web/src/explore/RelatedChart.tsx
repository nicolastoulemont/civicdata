import { inYear, type Related } from "@civicdata/domain"

import { type Moving, OverTime } from "./OverTime.tsx"
import { paths } from "./points.ts"
import { RelationChart } from "./RelationChart.tsx"

interface RelatedChartProps {
  resolved: Related
  moving: Moving | undefined
}

// A relation. One over time draws the year shown on axes fixed across its
// span, and while paused, each country's path from the span's first year.
export const RelatedChart = ({ resolved, moving }: RelatedChartProps) => {
  const { span } = resolved.view

  if (span === undefined) return <RelationChart resolved={resolved} />

  const travelled = paths(resolved)
  const covers = travelled.flatMap(({ points }) => points)

  // The View on screen is another chart while its data loads.
  if (moving === undefined)
    return <RelationChart resolved={inYear(resolved, resolved.view.year)} covers={covers} />

  return (
    <OverTime resolved={resolved} span={span} {...moving}>
      {(year, playing) => {
        const trails = playing
          ? []
          : travelled
              .map(({ country, points }) => ({
                country,
                points: points.filter((point) => point.year <= year),
              }))
              .filter(({ points }) => points.length > 1)

        return (
          <>
            <RelationChart resolved={inYear(resolved, year)} covers={covers} paths={trails} />
            {trails.length === 0 ? null : (
              <p className="text-sm text-muted-foreground">
                Lines trace each country from {span.from} to {year}.
              </p>
            )}
          </>
        )
      }}
    </OverTime>
  )
}
