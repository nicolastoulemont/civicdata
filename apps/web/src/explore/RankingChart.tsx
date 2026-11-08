import type { ResolvedView } from "@civicdata/domain"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

import { countryName, formatCompact } from "./format.ts"

const config = { value: { label: "Value", color: "var(--chart-1)" } } satisfies ChartConfig

export const RankingChart = ({ resolved }: { resolved: ResolvedView }) => {
  const ranked = resolved.observations
    .map((observation) => ({ name: countryName(observation.country), value: observation.value }))
    .toSorted((left, right) => right.value - left.value)

  return (
    <figure>
      <figcaption className="sr-only">{`Bar chart ranking countries by ${resolved.indicator.name}`}</figcaption>
      <ChartContainer
        config={config}
        className="aspect-auto w-full"
        style={{ height: ranked.length * 36 + 32 }}
      >
        <BarChart data={ranked} layout="vertical" accessibilityLayer>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" tickFormatter={formatCompact} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={120} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="value" fill="var(--color-value)" radius={4} />
        </BarChart>
      </ChartContainer>
    </figure>
  )
}
