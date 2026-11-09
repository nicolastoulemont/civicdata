import {
  type Country,
  type Election,
  type Event,
  type Government,
  type Reform,
  type ResolvedView,
  type Trend,
  When,
  yearOf,
} from "@civicdata/domain"
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
import {
  cited,
  governing,
  happening,
  reformed,
  span,
  spanOf,
  type Term,
  terms,
  votedIn,
  voting,
} from "./politics.ts"
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

// The years of a span that the chart shows, as the first and last year on
// its axis; none when the chart shows none of them.
const within = ({ from, to }: { from: number; to: number }, shown: ReadonlyArray<number>) => {
  const x1 = shown.find((year) => year >= from)
  const x2 = shown.findLast((year) => year <= to)

  return x1 === undefined || x2 === undefined || x1 > x2 ? [] : [{ x1, x2 }]
}

interface PoliticsProps {
  terms: ReadonlyArray<Term>
  elections: ReadonlyArray<Election>
  events: ReadonlyArray<Event>
  reforms: ReadonlyArray<Reform>
  countries: ReadonlyArray<Country>
  year: number
}

// Who governed each country in the hovered year, the elections it held and
// the reforms it made, then the events of the year, under its values.
// Nothing when the chart shows none of them.
const Politics = ({ terms: all, elections, events, reforms, countries, year }: PoliticsProps) => {
  const pages = cited([...events, ...reforms])

  const lines = [
    ...countries.flatMap((country) =>
      [
        ...governing(all, country, year),
        ...voting(elections, country, year),
        ...reformed(reforms, { country, shown: year, pages }),
      ].map((line) => (countries.length === 1 ? line : `${countryName(country)}: ${line}`)),
    ),
    ...happening(events, { countries, shown: year, pages }),
  ]

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
    Omit<PoliticsProps, "year"> {}

// The values of the hovered year and the political context of that year.
const Tip = ({ terms: all, elections, events, reforms, countries, ...tooltip }: TipProps) => (
  <ChartTooltipContent {...tooltip}>
    <Politics
      terms={all}
      elections={elections}
      events={events}
      reforms={reforms}
      countries={countries}
      year={Number(tooltip.label)}
    />
  </ChartTooltipContent>
)

const none: ReadonlyArray<never> = []

interface CaptionOptions extends Record<
  "bands" | "markers" | "periods" | "moments" | "reforming",
  ReadonlyArray<unknown>
> {
  countries: ReadonlyArray<Country>
}

// What the chart shows, for a screen reader: "Line chart of Unemployment for
// Spain, shaded by head of government, with election years marked".
const caption = (
  title: string,
  { countries, bands, markers, periods, moments, reforming }: CaptionOptions,
) =>
  [
    `Line chart of ${title} for ${countries.map(countryName).join(", ")}`,
    ...(bands.length > 0 ? ["shaded by head of government"] : []),
    ...(markers.length > 0 ? ["with election years marked"] : []),
    ...(periods.length + moments.length > 0 ? ["with events marked"] : []),
    ...(reforming.length > 0 ? ["with reforms marked"] : []),
  ].join(", ")

interface OverlaysOptions {
  // The years on the chart's axis, oldest first.
  axis: ReadonlyArray<number>
  countries: ReadonlyArray<Country>
  heads: ReadonlyArray<Term>
  elections: ReadonlyArray<Election>
  events: ReadonlyArray<Event>
  reforms: ReadonlyArray<Reform>
}

// Where the political context goes on a chart's axis: a band per head of
// government on a chart of one country (bands of several would overlap), a
// marker per country and year it voted in, a band per event period (one
// still going on runs to the chart's end), a marker per year of a dated
// event, and a marker per country and year it reformed.
const overlays = ({ axis, countries, heads, elections, events, reforms }: OverlaysOptions) => {
  const shown = new Set(axis)
  const last = axis.at(-1) ?? 0

  const reformedIn = (country: Country) =>
    reforms.flatMap((reform) =>
      reform.country === country && shown.has(yearOf(reform.date)) ? [yearOf(reform.date)] : [],
    )

  return {
    bands:
      countries.length === 1
        ? heads.flatMap((term) => within(span(term), axis).map(({ x1, x2 }) => ({ term, x1, x2 })))
        : [],
    markers: countries.flatMap((country) =>
      votedIn(elections, country).flatMap((year) => (shown.has(year) ? [{ country, year }] : [])),
    ),
    periods: events.flatMap((event) =>
      When.match(event.when, {
        Point: () => [],
        Period: () => within(spanOf(event, last), axis).map(({ x1, x2 }) => ({ event, x1, x2 })),
      }),
    ),
    moments: [
      ...new Set(
        events.flatMap((event) =>
          When.match(event.when, {
            Point: ({ at }) => (shown.has(yearOf(at.date)) ? [yearOf(at.date)] : []),
            Period: () => [],
          }),
        ),
      ),
    ],
    reforming: countries.flatMap((country) =>
      [...new Set(reformedIn(country))].map((year) => ({ country, year })),
    ),
  }
}

interface TrendChartProps {
  resolved: ResolvedView
  // The trend on screen, which `resolved` may not have caught up with yet.
  trend: Trend
  history?: History | undefined
  // The governments, elections, events and reforms of the trend's countries,
  // when the chart shows them.
  governments?: ReadonlyArray<Government> | undefined
  elections?: ReadonlyArray<Election> | undefined
  events?: ReadonlyArray<Event> | undefined
  reforms?: ReadonlyArray<Reform> | undefined
}

// One line per country. With a history, a window under the chart picks its
// years; the value scale then fits the whole history, so it stays put while
// the window moves. With governments, the tooltip names who governed each
// country in the hovered year, and a chart of one country is shaded in a
// band per head of government. Bands of several countries would overlap.
// With elections, a dashed line in each country's colour marks the years it
// voted in, and the tooltip names the elections. With events, a light band
// covers each period and a thin line marks each dated event, and a dotted
// line in a country's colour marks each of its reforms; the tooltip names
// them and numbers their sources in the card's source line.
export const TrendChart = ({
  resolved,
  trend,
  history,
  governments,
  elections = none,
  events = none,
  reforms = none,
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

  const { bands, markers, periods, moments, reforming } = overlays({
    axis: rows.map((row) => row.year),
    countries: trend.countries,
    heads,
    elections,
    events,
    reforms,
  })

  const config: ChartConfig = Object.fromEntries(
    trend.countries.map((country, index) => [
      country,
      { label: countryName(country), color: fill(slot(index)) },
    ]),
  )

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="sr-only">
        {caption(resolved.title, {
          countries: trend.countries,
          bands,
          markers,
          periods,
          moments,
          reforming,
        })}
      </figcaption>
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
          {periods.map(({ event, x1, x2 }) => (
            <ReferenceArea
              key={event.id}
              x1={x1}
              x2={x2}
              ifOverflow="hidden"
              fill="var(--foreground)"
              fillOpacity={0.05}
            />
          ))}
          <CartesianGrid vertical={false} />
          {moments.map((year) => (
            <ReferenceLine
              key={`event ${year}`}
              x={year}
              stroke="var(--foreground)"
              strokeOpacity={0.45}
              ifOverflow="hidden"
            />
          ))}
          {reforming.map(({ country, year }) => (
            <ReferenceLine
              key={`reform ${country} ${year}`}
              x={year}
              stroke={`var(--color-${country})`}
              strokeDasharray="1 3"
              strokeWidth={2}
              ifOverflow="hidden"
            />
          ))}
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
            content={
              <Tip
                terms={heads}
                elections={elections}
                events={events}
                reforms={reforms}
                countries={trend.countries}
              />
            }
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
