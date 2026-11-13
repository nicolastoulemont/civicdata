import type { ResolvedView } from "@repo/domain"
import { useTranslation } from "react-i18next"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

import { fill } from "./palette.ts"
import { ShowAll } from "./ShowAll.tsx"
import { useFormat } from "./useFormat.ts"

interface RankingChartProps {
  // One year's values.
  resolved: ResolvedView
  // The axis of a ranking over time, fixed across its span.
  domain?: readonly [number, number] | undefined
}

// One bar per country, highest first; past 25 countries, a button shows the
// rest.
export const RankingChart = ({ resolved, domain }: RankingChartProps) => {
  const { t } = useTranslation("explore")
  const config = { value: { label: t(($) => $["Value"]), color: fill(1) } } satisfies ChartConfig

  const { countryName, formatCompact } = useFormat()

  const ranked = resolved.observations
    .map((observation) => ({ name: countryName(observation.country), value: observation.value }))
    .toSorted((left, right) => right.value - left.value)

  return (
    <figure>
      <figcaption className="sr-only">
        {t(($) => $["Bar chart ranking countries by {{value1}}"], { value1: resolved.title })}
      </figcaption>
      <ShowAll rows={ranked}>
        {(shown) => (
          <ChartContainer
            config={config}
            className="aspect-auto w-full"
            style={{ height: shown.length * 36 + 32 }}
          >
            <BarChart data={[...shown]} layout="vertical" accessibilityLayer>
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                domain={domain === undefined ? [0, "auto"] : [...domain]}
                tickFormatter={formatCompact}
                tickLine={false}
                axisLine={false}
              />
              <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={120} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </ShowAll>
    </figure>
  )
}
