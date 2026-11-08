import type { ResolvedView, Trend } from "@civicdata/domain"
import { Match } from "effect"

import { attribution, countryName, formatCompact, period, transformLabel } from "@/explore/format"
import { places } from "@/explore/preview"

import { type Canvas, canvas, type Ink, line, png, rect, series, text } from "./canvas.ts"
import { body, label, title } from "./faces.gen.ts"
import { fit, measure, wrap } from "./font.ts"

// Link-preview cards are 600 by 315: the smallest size Facebook shows as a
// large card, and small enough to draw within the 10 ms of CPU a request gets
// on Workers Free. Text stays a little larger than half of 1200 by 630 would
// give, so labels remain readable.
const width = 600
const height = 315
const margin = 28

interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

// Round tick values covering low to high, about four steps apart.
const ticks = (low: number, high: number) => {
  const rough = (high - low) / 4
  const power = 10 ** Math.floor(Math.log10(rough))

  const step =
    [1, 2, 5, 10].map((multiple) => multiple * power).find((size) => size >= rough) ?? rough

  const first = Math.floor(low / step) * step
  const count = Math.round((Math.ceil(high / step) * step - first) / step)

  return Array.from({ length: count + 1 }, (_, index) => first + index * step)
}

// The value range a chart shows: from zero, like the site's charts, and never
// empty, so all-equal values still draw.
const domain = (values: ReadonlyArray<number>) => {
  const low = Math.min(0, ...values)
  const high = Math.max(0, ...values)

  return high === low ? { low, high: low + 1 } : { low, high }
}

const widest = (labels: ReadonlyArray<string>, face = label) =>
  Math.max(0, ...labels.map((each) => measure(face, each)))

// Where a trend chart puts a year and a value.
interface Frame {
  readonly plot: Box
  readonly x: (year: number) => number
  readonly y: (value: number) => number
}

const drawAxes = (
  image: Canvas,
  { frame, scale, trend }: { frame: Frame; scale: ReadonlyArray<number>; trend: Trend },
) => {
  const { plot, y } = frame

  for (const tick of scale) {
    rect(image, { x: plot.left, y: y(tick), width: plot.right - plot.left, height: 1 }, "border")
    text(image, label, formatCompact(tick), {
      x: plot.left - 6,
      y: y(tick) + 4,
      ink: "muted",
      align: "end",
    })
  }

  text(image, label, `${trend.from}`, { x: plot.left, y: plot.bottom + 16, ink: "muted" })

  if (trend.to !== trend.from) {
    const end = { x: plot.right, y: plot.bottom + 16, ink: "muted", align: "end" } as const

    text(image, label, `${trend.to}`, end)
  }
}

// One country's values, in year order. A year without a value breaks the
// line, as on the site; a value with no neighbour is a dot.
const drawLine = (
  image: Canvas,
  points: ResolvedView["observations"],
  { frame, ink }: { frame: Frame; ink: Ink },
) => {
  const at = (point: ResolvedView["observations"][number]) =>
    [frame.x(point.year), frame.y(point.value)] as const

  for (const [index, point] of points.entries()) {
    const next = points[index + 1]

    const joined = (other: typeof next) =>
      other !== undefined && Math.abs(other.year - point.year) === 1

    if (next !== undefined && joined(next)) line(image, at(point), at(next), { ink, width: 2 })
    else if (!joined(points[index - 1])) line(image, at(point), at(point), { ink, width: 4 })
  }
}

// Names at the ends of the lines, pushed apart so they do not overlap. Names
// that would fall below the chart are left out.
const drawNames = (
  image: Canvas,
  ends: ReadonlyArray<{ name: string; y: number }>,
  { plot, room }: { plot: Box; room: number },
) => {
  let floor = -Infinity

  for (const end of ends.toSorted((left, right) => left.y - right.y)) {
    const at = Math.max(end.y + 4, floor + 13)

    if (at > plot.bottom + 4) return

    text(image, label, fit(label, end.name, room), { x: plot.right + 6, y: at, ink: "muted" })
    floor = at
  }
}

const drawTrend = (image: Canvas, resolved: ResolvedView, trend: Trend, box: Box) => {
  const range = domain(resolved.observations.map((observation) => observation.value))
  const scale = ticks(range.low, range.high)
  const low = scale[0] ?? 0
  const high = scale.at(-1) ?? 1

  const lines = trend.countries
    .map((country, index) => ({
      name: countryName(country),
      ink: series[index % series.length] ?? "chart-1",
      points: resolved.observations
        .filter((observation) => observation.country === country)
        .toSorted((left, right) => left.year - right.year),
    }))
    .filter((drawn) => drawn.points.length > 0)

  const names = Math.min(90, widest(lines.map((drawn) => drawn.name)))

  const plot = {
    left: box.left + widest(scale.map(formatCompact)) + 6,
    right: box.right - names - 6,
    top: box.top + 4,
    bottom: box.bottom - 16,
  }

  const span = trend.to - trend.from

  const frame: Frame = {
    plot,
    x: (year) =>
      span === 0
        ? (plot.left + plot.right) / 2
        : plot.left + ((year - trend.from) / span) * (plot.right - plot.left),
    y: (value) => plot.bottom - ((value - low) / (high - low)) * (plot.bottom - plot.top),
  }

  drawAxes(image, { frame, scale, trend })

  for (const drawn of lines) drawLine(image, drawn.points, { frame, ink: drawn.ink })

  drawNames(
    image,
    lines.map((drawn) => ({ name: drawn.name, y: frame.y(drawn.points.at(-1)?.value ?? 0) })),
    { plot, room: names },
  )
}

const drawRanking = (image: Canvas, resolved: ResolvedView, box: Box) => {
  const ranked = resolved.observations.toSorted((left, right) => right.value - left.value)
  const row = 18
  const fits = Math.floor((box.bottom - box.top) / row)
  const shown = ranked.length > fits ? ranked.slice(0, fits - 1) : ranked
  const names = Math.min(120, widest(shown.map((observation) => countryName(observation.country))))
  const { low, high } = domain(ranked.map((observation) => observation.value))

  const plot = {
    left: box.left + names + 8,
    right: box.right - widest(shown.map((observation) => formatCompact(observation.value))) - 6,
  }

  const x = (value: number) => plot.left + ((value - low) / (high - low)) * (plot.right - plot.left)

  for (const [index, observation] of shown.entries()) {
    const top = box.top + index * row
    const zero = x(0)
    const end = x(observation.value)

    text(image, label, fit(label, countryName(observation.country), names), {
      x: plot.left - 8,
      y: top + 13,
      ink: "foreground",
      align: "end",
    })
    rect(
      image,
      {
        x: Math.min(zero, end),
        y: top + 4,
        width: Math.max(1, Math.abs(end - zero)),
        height: row - 8,
      },
      "chart-1",
    )
    text(image, label, formatCompact(observation.value), {
      x: observation.value < 0 ? end - 4 : end + 4,
      y: top + 13,
      ink: "foreground",
      align: observation.value < 0 ? "end" : "start",
    })
  }

  if (shown.length < ranked.length) {
    text(image, label, `and ${ranked.length - shown.length} more`, {
      x: plot.left,
      y: box.top + shown.length * row + 13,
      ink: "muted",
    })
  }
}

// Draws a resolved View as a PNG link-preview card: the indicator, the
// countries and years, the chart, and the source.
export const card = (resolved: ResolvedView) => {
  const image = canvas(width, height)
  const view = resolved.view
  const shows = transformLabel(view)
  let y = margin

  for (const row of wrap(title, resolved.indicator.name, { width: width - 2 * margin, lines: 2 })) {
    text(image, title, row, { x: margin, y: y + title.ascent, ink: "foreground" })
    y += title.size * 1.25
  }

  const subtitle = [places(view), period(view), ...(shows === undefined ? [] : [shows])].join(" · ")

  text(image, body, fit(body, subtitle, width - 2 * margin), {
    x: margin,
    y: y + 4 + body.ascent,
    ink: "muted",
  })

  const footer = height - 22

  text(image, label, fit(label, attribution(resolved), width - 2 * margin - 70), {
    x: margin,
    y: footer,
    ink: "muted",
  })
  text(image, body, "civicdata", { x: width - margin, y: footer, ink: "foreground", align: "end" })

  const box = {
    left: margin,
    top: y + 4 + body.size * 1.25 + 12,
    right: width - margin,
    bottom: footer - 20,
  }

  if (resolved.observations.length === 0) {
    text(image, body, "No data for these countries and years", {
      x: margin,
      y: (box.top + box.bottom) / 2,
      ink: "muted",
    })
  } else {
    Match.valueTags(view, {
      Trend: (trend) => drawTrend(image, resolved, trend, box),
      Ranking: () => drawRanking(image, resolved, box),
    })
  }

  return png(image)
}
