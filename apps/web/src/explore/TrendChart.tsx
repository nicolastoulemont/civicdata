import type { Country, Election, Government, ResolvedView, Trend } from "@civicdata/domain"
import { Match } from "effect"
import { type ComponentProps, useState } from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

import { countryName, formatCompact } from "./format.ts"
import { fill, slot } from "./palette.ts"
import { governing, span, type Term, terms, votedIn, voting } from "./politics.ts"
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

// The years a term spans that the chart shows, as the first and last year
// on its axis; none when the chart shows none of them.
const bandOf = (term: Term, shown: ReadonlyArray<number>) => {
  const { from, to } = span(term)
  const x1 = shown.find((year) => year >= from)
  const x2 = shown.findLast((year) => year <= to)

  return x1 === undefined || x2 === undefined || x1 > x2 ? [] : [{ term, x1, x2 }]
}

interface ContextProps {
  terms: ReadonlyArray<Term>
  elections: ReadonlyArray<Election>
  countries: ReadonlyArray<Country>
  year: number
}

// Who governed each country in the hovered year and the elections it held,
// under its values. Nothing when the chart shows neither.
const Context = ({ terms: all, elections, countries, year }: ContextProps) => {
  const lines = countries.flatMap((country) =>
    [...governing(all, country, year), ...voting(elections, country, year)].map((line) =>
      countries.length === 1 ? line : `${countryName(country)}: ${line}`,
    ),
  )

  return lines.length === 0 ? null : (
    <ul className="grid max-w-72 gap-1 border-t pt-1.5 text-muted-foreground">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

// Recharts sets `active`, `payload` and `label` on the element it renders as
// the tooltip.
interface TipProps
  extends
    Pick<ComponentProps<typeof ChartTooltipContent>, "active" | "payload" | "label">,
    Omit<ContextProps, "year"> {}

// The values of the hovered year and the political context of that year.
const Tip = ({ terms: all, elections, countries, ...tooltip }: TipProps) => (
  <ChartTooltipContent {...tooltip}>
    <Context terms={all} elections={elections} countries={countries} year={Number(tooltip.label)} />
  </ChartTooltipContent>
)

const none: ReadonlyArray<Election> = []

interface TrendChartProps {
  resolved: ResolvedView
  // The trend on screen, which `resolved` may not have caught up with yet.
  trend: Trend
  history?: History | undefined
  // The governments and elections of the trend's countries, when the chart
  // shows them.
  governments?: ReadonlyArray<Government> | undefined
  elections?: ReadonlyArray<Election> | undefined
}

// One line per country. With a history, a window under the chart picks its
// years; the value scale then fits the whole history, so it stays put while
// the window moves. With governments, the tooltip names who governed each
// country in the hovered year, and a chart of one country is shaded in a
// band per head of government. Bands of several countries would overlap.
// With elections, a dashed line in each country's colour marks the years it
// voted in, and the tooltip names the elections.
export const TrendChart = ({
  resolved,
  trend,
  history,
  governments,
  elections = none,
}: TrendChartProps) => {
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

  const rows = byYear(observations)
  const heads = governments === undefined ? [] : terms(governments)

  const bands =
    trend.countries.length === 1
      ? heads.flatMap((term) =>
          bandOf(
            term,
            rows.map((row) => row.year),
          ),
        )
      : []

  const shown = new Set(rows.map((row) => row.year))

  const markers = trend.countries.flatMap((country) =>
    votedIn(elections, country)
      .filter((year) => shown.has(year))
      .map((year) => ({ country, year })),
  )

  const config: ChartConfig = Object.fromEntries(
    trend.countries.map((country, index) => [
      country,
      { label: countryName(country), color: fill(slot(index)) },
    ]),
  )

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="sr-only">{`Line chart of ${resolved.title} for ${trend.countries.map(countryName).join(", ")}${bands.length > 0 ? ", shaded by head of government" : ""}${markers.length > 0 ? ", with election years marked" : ""}`}</figcaption>
      <ChartContainer config={config} className="aspect-auto h-80 w-full">
        <LineChart data={rows} accessibilityLayer>
          {bands.map(({ term, x1, x2 }, index) => (
            <ReferenceArea
              key={`${term.head} ${term.governments[0].start}`}
              x1={x1}
              x2={x2}
              ifOverflow="hidden"
              fill="var(--muted-foreground)"
              fillOpacity={index % 2 === 0 ? 0.06 : 0.12}
              // A band under two years wide has no room for a name; the
              // tooltip still gives it.
              {...(x2 - x1 >= 2
                ? {
                    label: {
                      value: term.head,
                      position: "insideTopLeft",
                      fontSize: 11,
                      fill: "var(--muted-foreground)",
                    },
                  }
                : {})}
            />
          ))}
          <CartesianGrid vertical={false} />
          {markers.map(({ country, year }) => (
            <ReferenceLine
              key={`${country} ${year}`}
              x={year}
              stroke={`var(--color-${country})`}
              strokeDasharray="4 4"
              ifOverflow="hidden"
            />
          ))}
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
          <ChartTooltip
            content={<Tip terms={heads} elections={elections} countries={trend.countries} />}
          />
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
