import type { Country } from "@openfacts/domain"
import { useTranslation } from "react-i18next"
import { CartesianGrid, LabelList, Scatter, ScatterChart, XAxis, YAxis } from "recharts"

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

import { color, fill } from "./palette.ts"
import { type Paired, pairs } from "./points.ts"
import { around } from "./scale.ts"
import { useFormat } from "./useFormat.ts"

// Where a country's dot has been, oldest first.
interface Path {
  readonly country: Country
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>
}

const still: ReadonlyArray<Path> = []

interface RelationChartProps {
  // One year's values.
  resolved: Paired
  // The values the axes cover: every year's, for a relation over time.
  covers?: ReadonlyArray<{ readonly x: number; readonly y: number }> | undefined
  // Each country's path up to the year shown, while a relation over time is
  // paused.
  paths?: ReadonlyArray<Path> | undefined
}

// A dot per country: the indicator up the side, the one it is plotted against
// along the bottom. A paused relation over time draws faintly, in each
// country's colour, the path its dot took to the year shown.
export const RelationChart = ({ resolved, covers, paths = still }: RelationChartProps) => {
  const { t } = useTranslation("explore")

  const { countryName, formatCompact } = useFormat()

  const points = pairs(resolved).map(({ country, x, y }) => ({
    country,
    x,
    y,
    name: countryName(country),
  }))

  const along = around((covers ?? points).map((point) => point.x))
  const up = around((covers ?? points).map((point) => point.y))

  // The axes by indicator title, and the countries by name for the tooltip's title.
  const config: ChartConfig = {
    x: { label: resolved.against.title, color: fill(1) },
    y: { label: resolved.title, color: fill(1) },
    ...Object.fromEntries(points.map((point) => [point.country, { label: point.name }])),
  }

  return (
    <figure>
      <figcaption className="sr-only">
        {t(($) => $["Scatter plot of {{value1}} against {{value2}}, by country"], {
          value1: resolved.title,
          value2: resolved.against.title,
        })}
      </figcaption>
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
          {paths.map(({ country, points: path }) => (
            <Scatter
              key={country}
              data={[...path]}
              line={{ stroke: color(country), strokeOpacity: 0.4, strokeWidth: 1.5 }}
              fill="none"
              legendType="none"
              tooltipType="none"
              isAnimationActive={false}
            />
          ))}
          <Scatter data={points} fill="var(--color-y)">
            <LabelList dataKey="name" position="top" className="fill-muted-foreground" />
          </Scatter>
        </ScatterChart>
      </ChartContainer>
    </figure>
  )
}
