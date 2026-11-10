import {
  type Change,
  type Country,
  countries,
  regionOf,
  type ResolvedView,
  type Trend,
} from "@civicdata/domain"
import { Match } from "effect"

import { colors } from "@/explore/colors.gen"
import {
  attribution,
  countryName,
  formatCompact,
  indicatorNames,
  period,
  picks,
  subject,
  transformLabel,
} from "@/explore/format"
import { changes, type Paired, pairs } from "@/explore/points"
import { places } from "@/explore/preview"
import { around, ticks } from "@/explore/scale"
import { load, rings, type Sheet, shades, type Steps } from "@/explore/sheet"

import { type Canvas, canvas, fill, type Ink, line, png, rect, mapInks, text } from "./canvas.ts"
import { body, label, title } from "./faces.gen.ts"
import { fit, measure, wrap } from "./font.ts"

// Link-preview cards are 600 by 315: the smallest size Facebook shows as a
// large card. Text stays a little larger than half of 1200 by 630 would
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

// The value scale up the side, with a gridline at each tick.
const drawSide = (
  image: Canvas,
  { frame, scale }: { frame: Frame; scale: ReadonlyArray<number> },
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
}

const drawAxes = (
  image: Canvas,
  { frame, scale, trend }: { frame: Frame; scale: ReadonlyArray<number>; trend: Trend },
) => {
  const { plot } = frame

  drawSide(image, { frame, scale })
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
    .map((country) => ({
      name: countryName(country),
      ink: colors[country].light,
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

// Where a change's values fall along a row: `names` wide for the country
// names on the left, `room` kept free on the right for labels. Dots mark
// values, not lengths, so the scale fits the values rather than start at zero.
const across = (
  box: Box,
  { values, names, room }: { values: ReadonlyArray<number>; names: number; room: number },
) => {
  const { low, high } = around(values)
  const left = box.left + names + 8
  const right = box.right - room

  return (value: number) => left + ((value - low) / (high - low)) * (right - left)
}

// A row per country, the largest rise first: a dot for each year joined by a
// line, and the last year's value. A key above names the years.
const drawChange = (image: Canvas, resolved: ResolvedView, change: Change, box: Box) => {
  const row = 18
  const all = changes(resolved, change)
  const fits = Math.floor((box.bottom - box.top) / row) - 1
  const shown = all.length > fits ? all.slice(0, fits - 1) : all
  const labels = shown.map((each) => formatCompact(each.to))
  const names = Math.min(120, widest(shown.map((each) => countryName(each.country))))

  const x = across(box, {
    values: all.flatMap((each) => [each.from, each.to]),
    names,
    room: widest(labels) + 10,
  })

  const key = { x: box.left + names + 12, y: box.top + 13 }

  line(image, [key.x, key.y - 4], [key.x, key.y - 4], { ink: "chart-other", width: 7 })
  text(image, label, `${change.from}`, { x: key.x + 8, y: key.y, ink: "muted" })
  line(image, [key.x + 48, key.y - 4], [key.x + 48, key.y - 4], { ink: "chart-1", width: 7 })
  text(image, label, `${change.to}`, { x: key.x + 56, y: key.y, ink: "muted" })

  for (const [index, each] of shown.entries()) {
    const middle = box.top + (index + 1) * row + 9
    const from = x(each.from)
    const to = x(each.to)

    text(image, label, fit(label, countryName(each.country), names), {
      x: box.left + names,
      y: middle + 4,
      ink: "foreground",
      align: "end",
    })
    line(image, [from, middle], [to, middle], { ink: "border", width: 2 })
    line(image, [from, middle], [from, middle], { ink: "chart-other", width: 7 })
    line(image, [to, middle], [to, middle], { ink: "chart-1", width: 7 })
    text(image, label, labels[index] ?? "", {
      x: Math.max(from, to) + 8,
      y: middle + 4,
      ink: "foreground",
    })
  }

  if (shown.length < all.length) {
    text(image, label, `and ${all.length - shown.length} more`, {
      x: box.left + names + 8,
      y: box.top + (shown.length + 1) * row + 13,
      ink: "muted",
    })
  }
}

// A dot per country named beside it: the indicator up the side, the one it is
// plotted against along the bottom, named under its scale.
const drawRelation = (image: Canvas, resolved: Paired, box: Box) => {
  const points = pairs(resolved)
  const up = around(points.map((point) => point.y))
  const along = around(points.map((point) => point.x))

  const plot = {
    left: box.left + widest(up.ticks.map(formatCompact)) + 6,
    right: box.right - 8,
    top: box.top + 4,
    bottom: box.bottom - 30,
  }

  const x = (value: number) =>
    plot.left + ((value - along.low) / (along.high - along.low)) * (plot.right - plot.left)

  const y = (value: number) =>
    plot.bottom - ((value - up.low) / (up.high - up.low)) * (plot.bottom - plot.top)

  drawSide(image, { frame: { plot, x, y }, scale: up.ticks })

  for (const tick of along.ticks) {
    rect(image, { x: x(tick), y: plot.top, width: 1, height: plot.bottom - plot.top }, "border")
    text(image, label, formatCompact(tick), { x: x(tick) - 8, y: plot.bottom + 14, ink: "muted" })
  }

  text(image, label, fit(label, resolved.against.title, plot.right - plot.left), {
    x: plot.left,
    y: plot.bottom + 28,
    ink: "muted",
  })

  for (const point of points) {
    line(image, [x(point.x), y(point.y)], [x(point.x), y(point.y)], { ink: "chart-1", width: 7 })
  }

  for (const point of points) {
    const name = countryName(point.country)
    const room = plot.right - x(point.x) - 8
    const end = room < 40

    text(image, label, fit(label, name, Math.max(40, Math.min(90, room))), {
      x: end ? x(point.x) - 7 : x(point.x) + 7,
      y: y(point.y) + 4,
      ink: "foreground",
      align: end ? "end" : "start",
    })
  }
}

// An outline scaled into the card from its top-left corner.
const place = (outline: Steps, { x, y, scale }: { x: number; y: number; scale: number }) =>
  rings(outline).map((ring) => ring.map(([px, py]) => [x + px * scale, y + py * scale] as const))

// A one-pixel frame around a box.
const frame = (image: Canvas, box: { x: number; y: number; width: number; height: number }) => {
  const { x, y } = box

  rect(image, { x, y, width: box.width, height: 1 }, "border")
  rect(image, { x, y: y + box.height - 1, width: box.width, height: 1 }, "border")
  rect(image, { x, y, width: 1, height: box.height }, "border")
  rect(image, { x: x + box.width - 1, y, width: 1, height: box.height }, "border")
}

// The map's insets in two columns, each region boxed over its name.
const drawInsets = (
  image: Canvas,
  {
    sheet,
    inkOf,
    left,
    top,
    column,
    row,
  }: {
    sheet: Sheet
    inkOf: (country: Country) => Ink
    left: number
    top: number
    column: number
    row: number
  },
) => {
  for (const [index, inset] of sheet.insets.entries()) {
    const x = left + (index % 2) * (column + 8)
    const y = top + Math.floor(index / 2) * row
    const scale = Math.min(column / inset.width, (row - 18) / inset.height)

    frame(image, { x, y, width: inset.width * scale, height: inset.height * scale })
    fill(image, place(inset.outline, { x, y, scale }), inkOf(inset.country))
    text(image, label, inset.name, { x, y: y + inset.height * scale + 12, ink: "muted" })
  }
}

// A map shaded by rank, as on the site, then its insets, then the key. A
// country without a value stays the colour of a border.
const drawMap = async (image: Canvas, resolved: ResolvedView, box: Box) => {
  const sheet = await load(regionOf(resolved.view.countries))
  const { byCountry, key } = shades(resolved.observations)

  const inkOf = (country: Country): Ink => {
    const shade = byCountry.get(country)

    return shade === undefined ? "border" : (mapInks[shade] ?? "chart-1")
  }

  const labels = key.map(({ low, high }) =>
    low === high ? formatCompact(low) : `${formatCompact(low)}–${formatCompact(high)}`,
  )

  const room = Math.max(widest(labels), widest(["No data"])) + 30
  const column = widest(sheet.insets.map((inset) => inset.name))
  const columns = Math.min(2, sheet.insets.length)
  const insets = columns === 0 ? 0 : columns * (column + 8) + 8
  const row = (box.bottom - box.top) / Math.max(1, Math.ceil(sheet.insets.length / 2))

  const scale = Math.min(
    (box.right - box.left - room - insets) / sheet.width,
    (box.bottom - box.top) / sheet.height,
  )

  const at = { x: box.left, y: box.top, scale }

  fill(image, place(sheet.land, at), "land")

  for (const { code } of countries) {
    const outline = sheet.outlines[code]

    if (outline !== undefined) fill(image, place(outline, at), inkOf(code))
  }

  const left = box.left + sheet.width * scale + 16

  drawInsets(image, { sheet, inkOf, left, top: box.top, column, row })

  const rows = [
    ...key.map(({ shade }, index) => ({
      ink: mapInks[shade] ?? "chart-1",
      text: labels[index] ?? "",
    })),
    { ink: "border" as const, text: "No data" },
  ]

  for (const [index, entry] of rows.entries()) {
    const top = box.top + index * 16

    rect(image, { x: left + insets, y: top + 2, width: 10, height: 10 }, entry.ink)
    text(image, label, entry.text, { x: left + insets + 16, y: top + 11, ink: "muted" })
  }
}

// Draws a resolved View as a PNG link-preview card: the indicator, the
// countries and years, the chart, and the source. A map waits for its
// outlines to load.
export const card = async (resolved: ResolvedView) => {
  const image = canvas(width, height)
  const view = resolved.view
  const known = indicatorNames([resolved])
  const shows = transformLabel(view, known)
  let y = margin

  const heading = subject(view, known)

  for (const row of wrap(title, heading, { width: width - 2 * margin, lines: 2 })) {
    text(image, title, row, { x: margin, y: y + title.ascent, ink: "foreground" })
    y += title.size * 1.25
  }

  const subtitle = [
    places(view),
    period(view),
    ...(shows === undefined ? [] : [shows]),
    ...picks(resolved),
  ].join(" · ")

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

  if (resolved.missing.length === view.countries.length) {
    text(image, body, "No data for these countries and years", {
      x: margin,
      y: (box.top + box.bottom) / 2,
      ink: "muted",
    })
  } else if ("against" in resolved) {
    drawRelation(image, resolved, box)
  } else {
    await Match.valueTags(resolved.view, {
      Trend: (trend) => drawTrend(image, resolved, trend, box),
      Ranking: (ranking) =>
        ranking.as === "Map" ? drawMap(image, resolved, box) : drawRanking(image, resolved, box),
      Change: (change) => drawChange(image, resolved, change, box),
    })
  }

  return png(image)
}
