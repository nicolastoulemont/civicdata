import { inYear, type Ranked } from "@repo/domain"
import { lazy, Suspense } from "react"

import { Skeleton } from "@/components/ui/skeleton"

import { type Moving, OverTime } from "./OverTime.tsx"
import { RankingChart } from "./RankingChart.tsx"
import { fromZero } from "./scale.ts"
import { bands } from "./sheet.ts"

// The map's outlines load only when a map is shown.
const RankingMap = lazy(() =>
  import("./RankingMap.tsx").then((module) => ({ default: module.RankingMap })),
)

interface RankedChartProps {
  resolved: Ranked
  moving: Moving | undefined
}

// A ranking as bars or a map. One over time draws the year shown on a scale
// fixed across its span: the bars' axis, or the map's shades, which follow
// values rather than ranks.
export const RankedChart = ({ resolved, moving }: RankedChartProps) => {
  const { span, as } = resolved.view
  const fixed = span === undefined ? undefined : resolved.observations

  const draw = (shown: Ranked) =>
    as === "Map" ? (
      <Suspense fallback={<Skeleton className="aspect-2/1 w-full" />}>
        <RankingMap resolved={shown} bands={fixed === undefined ? undefined : bands(fixed)} />
      </Suspense>
    ) : (
      <RankingChart
        resolved={shown}
        domain={fixed === undefined ? undefined : fromZero(fixed.map(({ value }) => value))}
      />
    )

  if (span === undefined) return draw(resolved)

  // The View on screen is another chart while its data loads.
  if (moving === undefined) return draw(inYear(resolved, resolved.view.year))

  return (
    <OverTime resolved={resolved} span={span} {...moving}>
      {(year) => draw(inYear(resolved, year))}
    </OverTime>
  )
}
