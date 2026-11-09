import { type Country, type ResolvedView, Year } from "@civicdata/domain"
import { type PointerEvent, useRef } from "react"

import { Slider } from "@/components/ui/slider"

export interface Years {
  readonly from: Year
  readonly to: Year
}

// A slider reports one value per thumb; this one has two.
const yearsOf = (value: number | ReadonlyArray<number>): Years => {
  const [from = 0, to = from] = [value].flat()

  return { from: Year.make(from), to: Year.make(to) }
}

// One line per country across the whole history, as an SVG path in a 100 by
// 100 box. A year without a value breaks the line.
const lineOf = (
  points: ResolvedView["observations"],
  { first, last, low, high }: { first: number; last: number; low: number; high: number },
) =>
  points
    .toSorted((left, right) => left.year - right.year)
    .map((point, index, all) => {
      const joined = index > 0 && all[index - 1]?.year === point.year - 1
      const x = ((point.year - first) / (last - first)) * 100
      const y = 100 - ((point.value - low) / (high - low)) * 100

      return `${joined ? "L" : "M"}${x},${y}`
    })
    .join(" ")

// Every country's whole history in miniature, with a window over the years
// the chart shows. Dragging an end resizes the window; dragging the window
// moves it. `onChange` follows the drag; `onCommit` fires when it ends.
export const YearWindow = ({
  history,
  countries,
  years,
  onChange,
  onCommit,
}: {
  history: ResolvedView["observations"]
  countries: ReadonlyArray<Country>
  years: Years
  onChange: (years: Years) => void
  onCommit: (years: Years) => void
}) => {
  const pan = useRef<{ x: number; width: number; start: Years; moved: Years } | null>(null)
  const all = history.map((observation) => observation.year)
  const first = Math.min(...all)
  const last = Math.max(...all)
  const values = history.map((observation) => observation.value)
  const low = Math.min(0, ...values)
  const high = Math.max(0, ...values)

  if (history.length === 0 || last === first) return null

  const from = Math.min(Math.max(years.from, first), last)
  const to = Math.max(Math.min(years.to, last), from)
  const at = (year: number) => `${((year - first) / (last - first)) * 100}%`

  // The window keeps its length; only whole years count.
  const shifted = (event: PointerEvent<HTMLDivElement>) => {
    const start = pan.current

    if (start === null || start.width === 0) return undefined

    const shift = Math.round(((event.clientX - start.x) / start.width) * (last - first))
    const length = start.start.to - start.start.from
    const next = Math.min(Math.max(start.start.from + shift, first), last - length)

    return { from: Year.make(next), to: Year.make(next + length) }
  }

  return (
    <Slider
      value={[from, to]}
      min={first}
      max={last}
      minStepsBetweenValues={1}
      thumbAlignment="center"
      labels={["First year", "Last year"]}
      onValueChange={(value) => onChange(yearsOf(value))}
      onValueCommitted={(value) => onCommit(yearsOf(value))}
      trackClassName="rounded-md border bg-transparent data-horizontal:h-12"
      rangeClassName="pointer-events-none border-y border-foreground/40 bg-transparent"
      thumbClassName="h-7 w-2.5 rounded-sm border-foreground/50 bg-card shadow-sm"
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 size-full overflow-visible"
        aria-hidden
      >
        {countries.map((country, index) => (
          <path
            key={country}
            d={lineOf(
              history.filter((observation) => observation.country === country),
              { first, last, low, high },
            )}
            fill="none"
            stroke={`var(--chart-${(index % 5) + 1})`}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="absolute inset-y-0 left-0 bg-muted/80" style={{ width: at(from) }} />
      <div
        className="absolute inset-y-0 right-0 bg-muted/80"
        style={{ width: `calc(100% - ${at(to)})` }}
      />
      <div
        aria-hidden
        className="absolute inset-y-0 cursor-grab active:cursor-grabbing"
        style={{ left: at(from), width: `calc(${at(to)} - ${at(from)})` }}
        onPointerDown={(event) => {
          // Keep the slider from moving the nearest end to the pointer.
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)

          const start = { from: Year.make(from), to: Year.make(to) }

          pan.current = {
            x: event.clientX,
            width: event.currentTarget.parentElement?.clientWidth ?? 0,
            start,
            moved: start,
          }
        }}
        onPointerMove={(event) => {
          const next = shifted(event)

          if (pan.current === null || next === undefined || next.from === pan.current.moved.from)
            return

          pan.current = { ...pan.current, moved: next }
          onChange(next)
        }}
        onPointerUp={() => {
          const moved = pan.current?.moved

          pan.current = null

          if (moved !== undefined) onCommit(moved)
        }}
        onPointerCancel={() => {
          pan.current = null
        }}
      />
    </Slider>
  )
}
