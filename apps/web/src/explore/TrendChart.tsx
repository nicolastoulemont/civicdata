import type { Country, ResolvedView } from "@civicdata/domain"
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

export const TrendChart = ({
  resolved,
  countries,
}: {
  resolved: ResolvedView
  countries: ReadonlyArray<Country>
}) => {
  const config: ChartConfig = Object.fromEntries(
    countries.map((country, index) => [
      country,
      { label: countryName(country), color: `var(--chart-${(index % 5) + 1})` },
    ]),
  )

  return (
    <figure>
      <figcaption className="sr-only">{`Line chart of ${resolved.indicator.name} for ${countries.map(countryName).join(", ")}`}</figcaption>
      <ChartContainer config={config} className="aspect-auto h-80 w-full">
        <LineChart data={byYear(resolved.observations)} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="year" tickLine={false} axisLine={false} />
          <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} width={56} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          {countries.map((country) => (
            <Line
              key={country}
              dataKey={country}
              type="monotone"
              stroke={`var(--color-${country})`}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </figure>
  )
}
