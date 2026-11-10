import { type Face, glyph } from "./font.ts"

// Light theme tokens as sRGB, including the five OKLab map blends.
const inks = {
  foreground: [10, 10, 10],
  muted: [115, 115, 115],
  border: [229, 229, 229],
  "chart-1": [42, 120, 214],
  "chart-other": [133, 133, 133],
  "chart-faint": [221, 221, 221],
  "map-0": [195, 207, 222],
  "map-1": [159, 186, 221],
  "map-2": [123, 165, 220],
  "map-3": [85, 143, 218],
  "map-4": [42, 120, 214],
} as const

type Token = keyof typeof inks

// A theme token, or a country's own colour as hex.
export type Ink = Token | `#${string}`

export const mapInks: ReadonlyArray<Ink> = ["map-0", "map-1", "map-2", "map-3", "map-4"]

const isToken = (ink: Ink): ink is Token => Object.hasOwn(inks, ink)

type Rgb = readonly [number, number, number]

const rgbOf = (ink: Ink): Rgb =>
  isToken(ink)
    ? inks[ink]
    : [
        Number.parseInt(ink.slice(1, 3), 16),
        Number.parseInt(ink.slice(3, 5), 16),
        Number.parseInt(ink.slice(5, 7), 16),
      ]

// Coverage is kept in 15 steps; a pixel's colour is its ink blended onto the
// white background by its coverage.
const steps = 15

// A white RGB image. `levels` keeps how much ink each pixel holds, so a faint
// edge never paints over a solid stroke.
export interface Canvas {
  readonly width: number
  readonly height: number
  readonly pixels: Uint8Array
  readonly levels: Uint8Array
}

export const canvas = (width: number, height: number): Canvas => ({
  width,
  height,
  pixels: new Uint8Array(width * height * 3).fill(255),
  levels: new Uint8Array(width * height),
})

// Inks the pixel at `at` unless it already holds more ink.
const paint = (target: Canvas, at: number, [red, green, blue]: Rgb, level: number) => {
  if (level <= 0 || level < (target.levels[at] ?? 0)) return

  const blended = (channel: number) => Math.round(255 + ((channel - 255) * level) / steps)

  target.levels[at] = level
  target.pixels[at * 3] = blended(red)
  target.pixels[at * 3 + 1] = blended(green)
  target.pixels[at * 3 + 2] = blended(blue)
}

// Inks the pixels from `from` up to `to` in full.
const solid = (target: Canvas, { from, to, rgb }: { from: number; to: number; rgb: Rgb }) => {
  for (let at = from; at < to; at += 1) target.pixels.set(rgb, at * 3)

  target.levels.fill(steps, from, to)
}

// The rows or columns from `from` to `to`, clipped to `size`.
const clip = (from: number, to: number, size: number) => ({
  first: Math.max(0, Math.floor(from)),
  last: Math.min(size - 1, Math.ceil(to)),
})

export const rect = (
  target: Canvas,
  box: { x: number; y: number; width: number; height: number },
  ink: Ink,
) => {
  const left = Math.max(0, Math.round(box.x))
  const right = Math.min(target.width, Math.round(box.x + box.width))

  for (
    let y = Math.max(0, Math.round(box.y));
    y < Math.min(target.height, Math.round(box.y + box.height));
    y += 1
  ) {
    solid(target, { from: y * target.width + left, to: y * target.width + right, rgb: rgbOf(ink) })
  }
}

type Edges = Float64Array

// The edges of the rings as x0, y0, x1, y1 in a row, for a fill to scan.
const edgesOf = (rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>): Edges => {
  const edges = new Float64Array(rings.reduce((total, ring) => total + ring.length, 0) * 4)
  let at = 0

  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const start = ring[index] ?? [0, 0]
      const end = ring[(index + 1) % ring.length] ?? start

      edges[at] = start[0]
      edges[at + 1] = start[1]
      edges[at + 2] = end[0]
      edges[at + 3] = end[1]
      at += 4
    }
  }

  return edges
}

// Where the edges cross the horizontal line at `y`, left to right.
const crossings = (edges: Edges, y: number) => {
  const found: Array<number> = []

  for (let edge = 0; edge < edges.length; edge += 4) {
    const x0 = edges[edge] ?? 0
    const y0 = edges[edge + 1] ?? 0
    const x1 = edges[edge + 2] ?? 0
    const y1 = edges[edge + 3] ?? 0

    if (y0 <= y !== y1 <= y) found.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0))
  }

  return found.toSorted((left, right) => left - right)
}

// Fills the area inside the rings with `ink`. A ring inside another is a
// hole (even-odd). Each pixel row is sampled through its middle, without
// antialiasing. Plain loops over a typed array keep a world map within the
// card's CPU budget.
export const fill = (
  target: Canvas,
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  ink: Ink,
) => {
  const rgb = rgbOf(ink)
  const edges = edgesOf(rings)
  const ys = rings.flatMap((ring) => ring.map(([, y]) => y))
  const rows = clip(Math.min(...ys), Math.max(...ys), target.height)

  for (let y = rows.first; y <= rows.last; y += 1) {
    const across = crossings(edges, y + 0.5)

    for (let index = 0; index + 1 < across.length; index += 2) {
      const left = Math.max(0, Math.round(across[index] ?? 0))
      const right = Math.min(target.width, Math.round(across[index + 1] ?? 0))

      if (right > left)
        solid(target, { from: y * target.width + left, to: y * target.width + right, rgb })
    }
  }
}

// A stroke with round ends, antialiased by each pixel's distance to the
// segment. A segment of zero length is a dot.
export const line = (
  target: Canvas,
  [x0, y0]: readonly [number, number],
  [x1, y1]: readonly [number, number],
  { ink, width }: { ink: Ink; width: number },
) => {
  const reach = width / 2 + 1
  const dx = x1 - x0
  const dy = y1 - y0
  const length = dx * dx + dy * dy
  const color = rgbOf(ink)
  const rows = clip(Math.min(y0, y1) - reach, Math.max(y0, y1) + reach, target.height)
  const columns = clip(Math.min(x0, x1) - reach, Math.max(x0, x1) + reach, target.width)

  // Along a row, only pixels within `reach` of the segment can be inked:
  // a band around where the segment crosses that row.
  const band = dy === 0 ? Infinity : (reach * Math.sqrt(length)) / Math.abs(dy)

  for (let y = rows.first; y <= rows.last; y += 1) {
    const crossing = dy === 0 ? x0 : x0 + ((y - y0) * dx) / dy
    const first = Math.max(columns.first, Math.floor(crossing - band))
    const last = Math.min(columns.last, Math.ceil(crossing + band))

    for (let x = first; x <= last; x += 1) {
      const t =
        length === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / length))

      const ex = x0 + t * dx - x
      const ey = y0 + t * dy - y
      const covered = width / 2 + 0.5 - Math.sqrt(ex * ex + ey * ey)

      if (covered > 0)
        paint(target, y * target.width + x, color, Math.round(Math.min(1, covered) * steps))
    }
  }
}

// The hex digit at `index` as a number: "0"-"9" are codes 48-57, "a"-"f" 97-102.
const digit = (alpha: string, index: number) => {
  const code = alpha.charCodeAt(index)

  return code < 58 ? code - 48 : code - 87
}

// Draws text with its baseline at `y`, starting at `x` or ending there.
export const text = (
  target: Canvas,
  face: Face,
  content: string,
  { x, y, ink, align = "start" }: { x: number; y: number; ink: Ink; align?: "start" | "end" },
) => {
  const color = rgbOf(ink)
  // Faces hold single UTF-16 code units only, so splitting by unit is exact.
  const glyphs = content.split("").map((character) => glyph(face, character))

  let pen =
    align === "start" ? x : x - glyphs.reduce((width, next) => width + (next?.advance ?? 0), 0)

  for (const drawn of glyphs) {
    if (drawn === undefined) continue

    const left = Math.round(pen) + drawn.left
    const top = Math.round(y) + drawn.top

    const rows = clip(top, top + drawn.height - 1, target.height)
    const columns = clip(left, left + drawn.width - 1, target.width)

    for (let row = rows.first; row <= rows.last; row += 1) {
      for (let column = columns.first; column <= columns.last; column += 1) {
        paint(
          target,
          row * target.width + column,
          color,
          digit(drawn.alpha, (row - top) * drawn.width + column - left),
        )
      }
    }

    pen += drawn.advance
  }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte

  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1

  return crc >>> 0
})

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff

  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)

  return (crc ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Uint8Array) => {
  const bytes = new Uint8Array(data.length + 12)
  const view = new DataView(bytes.buffer)

  view.setUint32(0, data.length)
  bytes.set(new TextEncoder().encode(type), 4)
  bytes.set(data, 8)
  view.setUint32(data.length + 8, crc32(bytes.subarray(4, data.length + 8)))

  return bytes
}

// Encodes the canvas as an 8-bit RGB PNG. The runtime's CompressionStream
// does the deflate ("deflate" is the zlib format PNG expects).
export const png = async (source: Canvas) => {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)

  view.setUint32(0, source.width)
  view.setUint32(4, source.height)
  // Bit depth 8, colour type 2 (RGB); compression, filter and interlace 0.
  header.set([8, 2, 0, 0, 0], 8)

  // Each row starts with filter type 0 (none).
  const row = source.width * 3
  const rows = new Uint8Array((row + 1) * source.height)

  for (let y = 0; y < source.height; y += 1) {
    rows.set(source.pixels.subarray(y * row, (y + 1) * row), y * (row + 1) + 1)
  }

  const compressed = new Uint8Array(
    await new Response(
      new Blob([rows]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  )

  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array(0)),
  ]

  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0

  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }

  return bytes
}
