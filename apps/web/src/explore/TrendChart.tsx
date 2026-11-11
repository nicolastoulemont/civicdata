import {
  type Country,
  type Election,
  type Event,
  type Government,
  type PartyColor,
  type Reform,
  type ResolvedView,
  type Trend,
  type View,
  When,
  yearOf,
} from "@openfacts/domain"
import { Match } from "effect"
import type { TFunction } from "i18next"
import { type ComponentProps, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
  usePlotArea,
  useYAxisScale,
} from "recharts"

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { useIsMobile } from "@/hooks/use-mobile"
import { useMachine } from "@/machine"

import { drag, held, type Years } from "./drag.ts"
import { color } from "./palette.ts"
import { usePolitics, cited, span, spanOf, type Term, terms, tint, votedIn } from "./politics.ts"
import { useFormat } from "./useFormat.ts"
import { YearWindow } from "./YearWindow.tsx"

type Point = { readonly year: number } & Partial<Record<Country, number>>

// One row per year from the first year with a value to the last, with a
// column per country. A year a country has no value for stays empty, so its
// line shows a gap instead of joining across it, and a year no country has
// a value for keeps its place on the axis: the Worldwide Governance
// Indicators skip 1997, 1999 and 2001.
const byYear = (observations: ResolvedView["observations"]) => {
  const rows = new Map<number, Point>()

  for (const { country, year, value } of observations) {
    rows.set(year, { ...rows.get(year), year, [country]: value })
  }

  const years = [...rows.keys()]

  if (years.length === 0) return []

  const first = Math.min(...years)

  return Array.from(
    { length: Math.max(...years) - first + 1 },
    (_, offset) => rows.get(first + offset) ?? { year: first + offset },
  )
}

// How faint the lines of other countries turn while one is brought forward.
const faint = 0.15

interface MarkedProps {
  country: Country
  faded: boolean
  flagged: ReadonlySet<string>
  alone: ReadonlySet<string>
  cx?: number
  cy?: number
  payload?: Point
}

// A ring on a point its source flags, a dot on a point with no value on
// either side, which no line reaches, and nothing on the others. Recharts
// passes each point's position and row.
const Marked = ({ country, faded, flagged, alone, cx, cy, payload }: MarkedProps) => {
  const key = payload === undefined ? undefined : `${country}:${payload.year}`

  if (key !== undefined && flagged.has(key)) {
    return (
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill="var(--background)"
        stroke={color(country)}
        strokeWidth={2}
        opacity={faded ? faint : 1}
      />
    )
  }

  return key !== undefined && alone.has(key) ? (
    <circle cx={cx} cy={cy} r={3} fill={color(country)} opacity={faded ? faint : 1} />
  ) : null
}

// The points of each country with no value the year before or after, as
// "FRA:1998".
const aloneIn = (rows: ReadonlyArray<Point>, countries: ReadonlyArray<Country>) =>
  new Set(
    countries.flatMap((country) =>
      rows.flatMap((row, index) =>
        row[country] !== undefined &&
        rows[index - 1]?.[country] === undefined &&
        rows[index + 1]?.[country] === undefined
          ? [`${country}:${row.year}`]
          : [],
      ),
    ),
  )

interface BandProps {
  x?: number
  y?: number
  width?: number
  height?: number
  fill?: string
  fillOpacity?: number
  clipPath?: string
}

// A head of government's band as a plain SVG rectangle, which Recharts sizes
// and clips. Its own Rectangle draws nothing outside a browser's layout, so
// tests could not see a band's colour.
const Band = ({ x, y, width, height, fill, fillOpacity, clipPath }: BandProps) => (
  <rect
    className="recharts-reference-area-rect"
    x={x}
    y={y}
    width={width}
    height={height}
    fill={fill}
    fillOpacity={fillOpacity}
    clipPath={clipPath}
  />
)

// Recharts' own margin around the plot.
const margin = { top: 5, right: 5, bottom: 5, left: 5 }

// Up to this many countries, each line is named at its end.
const named = 8

// A country's name, cut to fit beside the plot.
const short = (name: string) => {
  return name.length > 18 ? `${name.slice(0, 17)}…` : name
}

interface EndsProps {
  rows: ReadonlyArray<Point>
  countries: ReadonlyArray<Country>
  forward: Country | null
}

// Each line's name right of the plot, level with its last value and pushed
// apart so no two overlap, as on the share card. The legend names them too,
// so screen readers skip these.
const Ends = ({ rows, countries, forward }: EndsProps) => {
  const { countryName } = useFormat()
  const y = useYAxisScale()
  const plot = usePlotArea()

  if (y === undefined || plot === undefined) return null

  const ends = countries
    .flatMap((country) => {
      const last = rows.findLast((row) => row[country] !== undefined)?.[country]
      const at = last === undefined ? undefined : y(last)

      return at === undefined ? [] : [{ country, at }]
    })
    .toSorted((left, right) => left.at - right.at)

  const placed = ends.reduce<Array<{ country: Country; at: number }>>((above, { country, at }) => {
    above.push({ country, at: Math.max(at, (above.at(-1)?.at ?? -Infinity) + 14) })

    return above
  }, [])

  return (
    <g aria-hidden>
      {placed.map(({ country, at }) => (
        <text
          key={country}
          x={plot.x + plot.width + 6}
          y={at}
          dy="0.32em"
          fontSize={12}
          fill={country === forward ? "var(--foreground)" : "var(--muted-foreground)"}
          opacity={forward !== null && country !== forward ? faint : 1}
        >
          {short(countryName(country))}
        </text>
      ))}
    </g>
  )
}

// Room right of the plot for the names at the lines' ends, on a trend of
// few enough countries to name each. None past that, nor on a phone, which
// has no room beside the plot: the legend names the lines.
const useRoom = (countries: ReadonlyArray<Country>) => {
  const { countryName } = useFormat()

  return useIsMobile() || countries.length > named
    ? 0
    : Math.min(
        130,
        8 + 6.5 * Math.max(...countries.map((country) => short(countryName(country)).length)),
      )
}

// The country brought forward: the one pointed at in the legend, else the
// one pressed there. A country the trend no longer shows brings none. The
// others' lines fade.
const useForward = (countries: ReadonlyArray<Country>) => {
  const { t } = useTranslation("explore")
  const [pressed, setPressed] = useState<Country | null>(null)
  const [pointed, setPointed] = useState<Country | null>(null)
  const of = (key: string | null) => countries.find((each) => each === key) ?? null

  const forward =
    [pointed, pressed].find((each) => each !== null && countries.includes(each)) ?? null

  return {
    forward,
    faded: (country: Country) => forward !== null && country !== forward,
    picking: {
      label: t(($) => $["Highlight a country"]),
      pressed,
      onPress: (key: string | null) => setPressed(of(key)),
      onPoint: (key: string | null) => setPointed(of(key)),
    },
  }
}

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
  const { governing, voting, happening, reformed } = usePolitics()
  const { countryName } = useFormat()

  const pages = cited([...events, ...reforms])

  const lines = [
    ...countries.flatMap((country) =>
      [
        ...governing(all, { country, shown: year }),
        ...voting(elections, { country, shown: year }),
        ...reformed(reforms, { country, shown: year, pages }),
      ].map((line) => (countries.length === 1 ? line : `${countryName(country)}: ${line}`)),
    ),
    ...happening(events, { countries, shown: year, pages }),
  ]

  // As wide as fits on a phone, so a busy year wraps less and stays inside
  // the card.
  return lines.length === 0 ? null : (
    <ul className="grid max-w-[min(24rem,calc(100vw-5rem))] gap-1 border-t pt-1.5 text-muted-foreground">
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

// A line's value in the hovered year; a country without one sorts last.
const valueOf = ({ value }: { value?: unknown }) => Number(value ?? -Infinity)

// The hovered year, its values highest first so a reader finds a country
// among many, and the political context of that year. Recharts passes the
// year as a number, which the tooltip would read as a series and name after
// the first country.
const Tip = ({
  terms: all,
  elections,
  events,
  reforms,
  countries,
  payload,
  ...tooltip
}: TipProps) => (
  <ChartTooltipContent
    {...tooltip}
    label={`${Number(tooltip.label)}`}
    payload={(payload ?? []).toSorted((left, right) => valueOf(right) - valueOf(left))}
  >
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
  "markers" | "periods" | "moments" | "reforming",
  ReadonlyArray<unknown>
> {
  countries: ReadonlyArray<Country>
  t: TFunction<"explore">
  countryName: (country: Country) => string
  bands: ReadonlyArray<{ readonly color: PartyColor | null }>
}

// What the chart shows, for a screen reader: "Line chart of Unemployment for
// Spain, shaded by head of government, with election years marked".
const caption = (
  title: string,
  { countries, bands, markers, periods, moments, reforming, t, countryName }: CaptionOptions,
) =>
  [
    t(($) => $["Line chart of {{title}} for {{value2}}"], {
      title: title,
      value2: countries.map(countryName).join(", "),
    }),
    ...(bands.length > 0
      ? [
          bands.some((band) => band.color !== null)
            ? t(($) => $["shaded by head of government and tinted by their party"])
            : t(($) => $["shaded by head of government"]),
        ]
      : []),
    ...(markers.length > 0 ? [t(($) => $["with election years marked"])] : []),
    ...(periods.length + moments.length > 0 ? [t(($) => $["with events marked"])] : []),
    ...(reforming.length > 0 ? [t(($) => $["with reforms marked"])] : []),
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
        ? heads.flatMap((term) =>
            within(span(term), axis).map(({ x1, x2 }) => ({ term, x1, x2, color: tint(term) })),
          )
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

// One line per country, in the country's own colour, and a tooltip that
// lists the hovered year's values highest first. With a history, a window under the chart picks its
// years; the value scale then fits the whole history, so it stays put while
// the window moves. With governments, the tooltip names who governed each
// country in the hovered year, and a chart of one country is shaded in a
// band per head of government, tinted by the head's party where its colour
// is sourced. Bands of several countries would overlap.
// With elections, a dashed line in each country's colour marks the years it
// voted in, and the tooltip names the elections. With events, a light band
// covers each period and a thin line marks each dated event, and a dotted
// line in a country's colour marks each of its reforms; the tooltip names
// them and numbers their sources in the card's source line.
const drawBands = (bands: ReturnType<typeof overlays>["bands"]) =>
  bands.map(({ term, x1, x2, color: party }, index) => (
    <ReferenceArea
      key={`${term.head} ${term.governments[0].start}`}
      x1={x1}
      x2={x2}
      ifOverflow="hidden"
      // A light tint of the head's party's colour; grey without one.
      // Neighbouring bands alternate in strength, so two heads of one
      // party stay apart.
      // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Recharts names the prop.
      shape={Band}
      fill={party?.hex ?? "var(--muted-foreground)"}
      fillOpacity={(party === null ? 0.06 : 0.14) * (index % 2 === 0 ? 1 : 1.6)}
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
  ))

const coversYears = (view: View, years: Years) =>
  Match.value(view).pipe(
    Match.tag("Trend", ({ from, to }) => from === years.from && to === years.to),
    Match.orElse(() => false),
  )

interface DataOptions {
  history: History | undefined
  years: Years
  dragged: Years | undefined
}

const dataFor = (resolved: ResolvedView, { history, years, dragged }: DataOptions) => {
  // Whether `resolved` holds the years on screen: not while dragging, nor
  // while the years just picked load.
  const loaded = dragged === undefined && coversYears(resolved.view, years)

  const observations =
    history !== undefined && history.same && !loaded
      ? history.observations.filter(({ year }) => year >= years.from && year <= years.to)
      : resolved.observations

  const values = (history?.same === true ? history.observations : observations).map(
    (observation) => observation.value,
  )

  const rows = byYear(observations)

  return { rows, values }
}

export const TrendChart = ({
  resolved,
  trend,
  history,
  governments,
  elections = none,
  events = none,
  reforms = none,
}: TrendChartProps) => {
  const { t } = useTranslation("explore")

  const { countryName, formatCompact } = useFormat()

  // The points a source flags get a dot; the note under the chart says why.
  const flagged = new Set(
    resolved.observations.flatMap(({ country, year, flags }) =>
      flags === undefined ? [] : [`${country}:${year}`],
    ),
  )

  // The years a drag ends on become the trend's.
  const [dragging, gesture] = useMachine(drag, { on: (picked) => history?.onChange(picked) })
  const dragged = held(dragging)
  const years = dragged ?? { from: trend.from, to: trend.to }

  const { rows, values } = dataFor(resolved, { history, years, dragged })
  const alone = aloneIn(rows, trend.countries)
  const heads = governments === undefined ? [] : terms(governments)

  const { bands, markers, periods, moments, reforming } = overlays({
    axis: rows.map((row) => row.year),
    countries: trend.countries,
    heads,
    elections,
    events,
    reforms,
  })

  const { forward, faded, picking } = useForward(trend.countries)
  const room = useRoom(trend.countries)

  const config: ChartConfig = Object.fromEntries(
    trend.countries.map((country) => [country, { label: countryName(country) }]),
  )

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="sr-only">
        {caption(resolved.title, {
          t,
          countryName,
          countries: trend.countries,
          bands,
          markers,
          periods,
          moments,
          reforming,
        })}
      </figcaption>
      <ChartContainer config={config} className="aspect-auto h-80 w-full">
        <LineChart
          data={rows}
          margin={{ ...margin, right: margin.right + room }}
          accessibilityLayer
        >
          {drawBands(bands)}
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
              stroke={color(country)}
              strokeOpacity={faded(country) ? faint : 1}
              strokeDasharray="1 3"
              strokeWidth={2}
              ifOverflow="hidden"
            />
          ))}
          {markers.map(({ country, year }) => (
            <ReferenceLine
              key={`${country} ${year}`}
              x={year}
              stroke={color(country)}
              strokeOpacity={faded(country) ? faint : 1}
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
          {/* Rows wrap, so a legend of many countries stays inside the card. */}
          <ChartLegend
            content={<ChartLegendContent className="flex-wrap gap-y-1" picking={picking} />}
          />
          {trend.countries.map((country) => (
            <Line
              key={country}
              dataKey={country}
              type="monotone"
              stroke={color(country)}
              strokeOpacity={faded(country) ? faint : 1}
              strokeWidth={country === forward ? 3 : 2}
              dot={
                <Marked country={country} faded={faded(country)} flagged={flagged} alone={alone} />
              }
              connectNulls={false}
              isAnimationActive={dragged === undefined}
            />
          ))}
          {room > 0 ? <Ends rows={rows} countries={trend.countries} forward={forward} /> : null}
        </LineChart>
      </ChartContainer>
      {history === undefined ? null : (
        <div className="pl-14" style={{ paddingRight: 4 + room }}>
          <YearWindow
            history={history.observations}
            countries={trend.countries}
            years={years}
            onGesture={gesture}
          />
        </div>
      )}
    </figure>
  )
}
