import type { Change, ResolvedView } from "@repo/domain"
import { useTranslation } from "react-i18next"
import { Bar, CartesianGrid, ComposedChart, Scatter, XAxis, YAxis } from "recharts"

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

import { fill } from "./palette.ts"
import { changes, moved } from "./points.ts"
import { around } from "./scale.ts"
import { ShowAll } from "./ShowAll.tsx"
import { useFormat } from "./useFormat.ts"

const row = 36

// The second year's dot: one colour for a neutral indicator, else coloured
// by the way each country moved.
type Mark = "to" | ReturnType<typeof moved>

interface ChangeChartProps {
  resolved: ResolvedView
  change: Change
}

// One row per country, the largest rise first: a dot for each year, joined by
// a thin bar from the lower value to the higher. For an indicator with a
// direction, the second dot is green where the country moved the better way
// and red where it moved the worse way, and the chart says which way is
// better. The scale fits every row; past 25 countries, a button shows the
// rest.
export const ChangeChart = ({ resolved, change }: ChangeChartProps) => {
  const { phrase } = useFormat()

  const { t } = useTranslation("explore")

  const { countryName, formatCompact } = useFormat()

  const { direction } = resolved
  const better = phrase(direction)

  const labels: Record<Mark, ChartConfig[string]> = {
    to: { label: `${change.to}`, color: fill(1) },
    better: { label: t(($) => $["{{year}}, better"], { year: change.to }), color: fill("better") },
    worse: { label: t(($) => $["{{year}}, worse"], { year: change.to }), color: fill("worse") },
    same: { label: t(($) => $["{{year}}, unchanged"], { year: change.to }), color: fill("even") },
  }

  // A directed row holds its second value under the way it moved too, so
  // that series draws its dot.
  const rows = changes(resolved, change).map(({ country, from, to }) => {
    const mark: Mark = direction === "Neutral" ? "to" : moved(direction, { from, to })
    const under = (way: Mark) => (mark === way ? to : undefined)

    return {
      name: countryName(country),
      from,
      to,
      mark,
      better: under("better"),
      worse: under("worse"),
      same: under("same"),
      span: [Math.min(from, to), Math.max(from, to)],
    }
  })

  // Only the marks some country takes, in the order of the legend.
  const marks = (["to", "better", "worse", "same"] as const).filter((mark) =>
    rows.some((each) => each.mark === mark),
  )

  const config: ChartConfig = {
    from: { label: `${change.from}`, color: fill("other") },
    ...Object.fromEntries(marks.map((mark) => [mark, labels[mark]])),
  }

  // Dots mark values, not lengths, so the scale fits them rather than start
  // at zero.
  const scale = around(rows.flatMap((each) => [each.from, each.to]))

  return (
    <figure>
      <figcaption className="sr-only">
        {t(
          ($) => $["Change in {{value1}} between {{value2}} and {{value3}}, by country{{value4}}"],
          {
            value1: resolved.title,
            value2: change.from,
            value3: change.to,
            value4: better === undefined ? "" : `, ${better.toLowerCase()}`,
          },
        )}
      </figcaption>
      {better === undefined ? null : <p className="mb-2 text-sm">{better}</p>}
      <ShowAll rows={rows}>
        {(shown) => (
          <ChartContainer
            config={config}
            className="aspect-auto w-full"
            style={{ height: shown.length * row + 64 }}
          >
            <ComposedChart data={[...shown]} layout="vertical" accessibilityLayer>
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
              {/* In the order drawn: the first year, then the second. */}
              <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
              <Bar
                dataKey="span"
                barSize={2}
                fill="var(--border)"
                tooltipType="none"
                legendType="none"
              />
              <Scatter dataKey="from" fill="var(--color-from)" />
              {marks.map((mark) => (
                <Scatter key={mark} dataKey={mark} fill={`var(--color-${mark})`} />
              ))}
            </ComposedChart>
          </ChartContainer>
        )}
      </ShowAll>
    </figure>
  )
}
