import { CartesianGrid, LabelList, Scatter, ScatterChart, XAxis, YAxis } from "recharts"

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

import { countryName, formatCompact } from "./format.ts"
import { type Paired, pairs } from "./points.ts"
import { around } from "./scale.ts"

// A dot per country: the indicator up the side, the one it is plotted against
// along the bottom.
export const RelationChart = ({ resolved }: { resolved: Paired }) => {
  const points = pairs(resolved).map(({ country, x, y }) => ({
    country,
    x,
    y,
    name: countryName(country),
  }))

  const along = around(points.map((point) => point.x))
  const up = around(points.map((point) => point.y))

  // The axes by indicator title, and the countries by name for the tooltip's title.
  const config: ChartConfig = {
    x: { label: resolved.against.title, color: "var(--chart-4)" },
    y: { label: resolved.title, color: "var(--chart-4)" },
    ...Object.fromEntries(points.map((point) => [point.country, { label: point.name }])),
  }

  return (
    <figure>
      <figcaption className="sr-only">{`Scatter plot of ${resolved.title} against ${resolved.against.title}, by country`}</figcaption>
      <ChartContainer config={config} className="aspect-auto h-96 w-full">
        <ScatterChart margin={{ top: 16, right: 16, bottom: 24, left: 16 }} accessibilityLayer>
          <CartesianGrid />
          <XAxis
            type="number"
            dataKey="x"
            domain={[along.low, along.high]}
            ticks={along.ticks}
            tickFormatter={formatCompact}
            tickLine={false}
            axisLine={false}
            label={{ value: resolved.against.title, position: "bottom", offset: 8 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[up.low, up.high]}
            ticks={up.ticks}
            tickFormatter={formatCompact}
            tickLine={false}
            axisLine={false}
            width={56}
            label={{ value: resolved.title, angle: -90, position: "left", offset: 4 }}
          />
          <ChartTooltip content={<ChartTooltipContent labelKey="country" hideIndicator />} />
          <Scatter data={points} fill="var(--color-y)">
            <LabelList dataKey="name" position="top" className="fill-muted-foreground" />
          </Scatter>
        </ScatterChart>
      </ChartContainer>
    </figure>
  )
}
