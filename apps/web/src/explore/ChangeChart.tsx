import type { Change, ResolvedView } from "@civicdata/domain"
import { Bar, CartesianGrid, ComposedChart, Scatter, XAxis, YAxis } from "recharts"

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

import { countryName, formatCompact } from "./format.ts"
import { fill } from "./palette.ts"
import { changes } from "./points.ts"
import { around } from "./scale.ts"

const row = 36

interface ChangeChartProps {
  resolved: ResolvedView
  change: Change
}

// One row per country, the largest rise first: a dot for each year, joined by
// a thin bar from the lower value to the higher.
export const ChangeChart = ({ resolved, change }: ChangeChartProps) => {
  const config = {
    from: { label: `${change.from}`, color: fill("other") },
    to: { label: `${change.to}`, color: fill(1) },
  } satisfies ChartConfig

  const rows = changes(resolved, change).map(({ country, from, to }) => ({
    name: countryName(country),
    from,
    to,
    span: [Math.min(from, to), Math.max(from, to)],
  }))

  // Dots mark values, not lengths, so the scale fits them rather than start
  // at zero.
  const scale = around(rows.flatMap((each) => [each.from, each.to]))

  return (
    <figure>
      <figcaption className="sr-only">{`Change in ${resolved.title} between ${change.from} and ${change.to}, by country`}</figcaption>
      <ChartContainer
        config={config}
        className="aspect-auto w-full"
        style={{ height: rows.length * row + 64 }}
      >
        <ComposedChart data={rows} layout="vertical" accessibilityLayer>
          <CartesianGrid horizontal={false} />
          <XAxis
            type="number"
            domain={[scale.low, scale.high]}
            ticks={scale.ticks}
            tickFormatter={formatCompact}
            tickLine={false}
            axisLine={false}
          />
          <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={120} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar
            dataKey="span"
            barSize={2}
            fill="var(--border)"
            tooltipType="none"
            legendType="none"
          />
          <Scatter dataKey="from" fill="var(--color-from)" />
          <Scatter dataKey="to" fill="var(--color-to)" />
        </ComposedChart>
      </ChartContainer>
    </figure>
  )
}
