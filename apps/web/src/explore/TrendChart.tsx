import type { Country, ResolvedView, Trend } from "@civicdata/domain"
import { Match } from "effect"
import { useState } from "react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

import { countryName, formatCompact } from "./format.ts"
import { lineColor } from "./lines.ts"
import { type Years, YearWindow } from "./YearWindow.tsx"

type Point = { readonly year: number } & Partial<Record<Country, number>>

// One row per year with a column per country. A year a country has no value
// for stays empty, so its line shows a gap instead of joining across it.
const byYear = (observations: ResolvedView["observations"]) => {
  const rows = new Map<number, Point>()

  for (const { country, year, value } of observations) {
    rows.set(year, { ...rows.get(year), year, [country]: value })
  }

  return [...rows.values()].toSorted((left, right) => left.year - right.year)
}

interface MarkedProps {
  country: Country
  flagged: ReadonlySet<string>
  cx?: number
  cy?: number
  payload?: Point
}

// A dot on a point its source flags, and nothing on the others. Recharts
// passes each point's position and row.
const Marked = ({ country, flagged, cx, cy, payload }: MarkedProps) =>
  payload !== undefined && flagged.has(`${country}:${payload.year}`) ? (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill="var(--background)"
      stroke={`var(--color-${country})`}
      strokeWidth={2}
    />
  ) : null

// The trend's whole history, for picking its years over it.
export interface History {
  readonly observations: ResolvedView["observations"]
  // Whether the history holds the chart's own values, so the chart can follow
  // a drag before the new years load. An index starts at the first year shown,
  // so its history holds the values as published instead.
  readonly same: boolean
  readonly onChange: (years: Years) => void
}

interface TrendChartProps {
  resolved: ResolvedView
  // The trend on screen, which `resolved` may not have caught up with yet.
  trend: Trend
  history?: History | undefined
}

// One line per country. With a history, a window under the chart picks its
// years; the value scale then fits the whole history, so it stays put while
// the window moves.
export const TrendChart = ({ resolved, trend, history }: TrendChartProps) => {
  // The points a source flags get a dot; the note under the chart says why.
  const flagged = new Set(
    resolved.observations.flatMap(({ country, year, flags }) =>
      flags === undefined ? [] : [`${country}:${year}`],
    ),
  )

  const [dragged, setDragged] = useState<Years | null>(null)
  const years = dragged ?? { from: trend.from, to: trend.to }

  // Whether `resolved` holds the years on screen: not while dragging, nor
  // while the years just picked load.
  const loaded =
    dragged === null &&
    Match.value(resolved.view).pipe(
      Match.tag("Trend", ({ from, to }) => from === years.from && to === years.to),
      Match.orElse(() => false),
    )

  const observations =
    history !== undefined && history.same && !loaded
      ? history.observations.filter(({ year }) => year >= years.from && year <= years.to)
      : resolved.observations

  const values = (history?.same === true ? history.observations : observations).map(
    (observation) => observation.value,
  )

  const config: ChartConfig = Object.fromEntries(
    trend.countries.map((country, index) => [
      country,
      { label: countryName(country), color: lineColor(index) },
    ]),
  )

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="sr-only">{`Line chart of ${resolved.title} for ${trend.countries.map(countryName).join(", ")}`}</figcaption>
      <ChartContainer config={config} className="aspect-auto h-80 w-full">
        <LineChart data={byYear(observations)} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="year" tickLine={false} axisLine={false} />
          <YAxis
            // Without a history, Recharts' own default: from zero to the highest value.
            domain={
              history === undefined ? [0, "auto"] : [Math.min(0, ...values), Math.max(...values)]
            }
            tickFormatter={formatCompact}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          {trend.countries.map((country) => (
            <Line
              key={country}
              dataKey={country}
              type="monotone"
              stroke={`var(--color-${country})`}
              strokeWidth={2}
              dot={<Marked country={country} flagged={flagged} />}
              connectNulls={false}
              isAnimationActive={dragged === null}
            />
          ))}
        </LineChart>
      </ChartContainer>
      {history === undefined ? null : (
        <div className="pr-1 pl-14">
          <YearWindow
            history={history.observations}
            countries={trend.countries}
            years={years}
            onChange={setDragged}
            onCommit={(picked) => {
              setDragged(null)
              history.onChange(picked)
            }}
          />
        </div>
      )}
    </figure>
  )
}
