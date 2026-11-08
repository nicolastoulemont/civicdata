// Writes src/card/faces.gen.ts: Geist glyphs as bitmaps for the link-preview
// card, which the server draws without a font engine. Run with
// `pnpm --filter @civicdata/web run glyphs` after changing a face below.
import { readFileSync, writeFileSync } from "node:fs"

// opentype.js ships CommonJS, which Node exposes as a default export only.
// oxlint-disable-next-line import/default
import opentype from "opentype.js"

const faces = [
  { name: "title", weight: 600, size: 22 },
  { name: "body", weight: 400, size: 13 },
  { name: "label", weight: 400, size: 11 },
]

// Printable ASCII covers every World Bank indicator and economy name, apart
// from the en dash. The card adds "·" and "…".
const characters = [
  ...Array.from({ length: 95 }, (_, index) => String.fromCodePoint(32 + index)),
  "–",
  "·",
  "…",
]

// Sub-rows per pixel row. Coverage along each sub-row is exact.
const rows = 16

type Point = readonly [number, number]

// The outline as straight edges, with curves cut into short segments.
const edges = (path: opentype.Path) => {
  const found: Array<readonly [Point, Point]> = []
  let start: Point = [0, 0]
  let at: Point = [0, 0]

  const to = (next: Point) => {
    found.push([at, next])
    at = next
  }

  for (const command of path.commands) {
    if (command.type === "M") {
      start = [command.x, command.y]
      at = start
    } else if (command.type === "L") {
      to([command.x, command.y])
    } else if (command.type === "Q") {
      const from = at

      for (let step = 1; step <= 8; step += 1) {
        const t = step / 8
        const u = 1 - t

        to([
          u * u * from[0] + 2 * u * t * command.x1 + t * t * command.x,
          u * u * from[1] + 2 * u * t * command.y1 + t * t * command.y,
        ])
      }
    } else if (command.type === "C") {
      const from = at

      for (let step = 1; step <= 8; step += 1) {
        const t = step / 8
        const u = 1 - t

        to([
          u * u * u * from[0] +
            3 * u * u * t * command.x1 +
            3 * u * t * t * command.x2 +
            t * t * t * command.x,
          u * u * u * from[1] +
            3 * u * u * t * command.y1 +
            3 * u * t * t * command.y2 +
            t * t * t * command.y,
        ])
      }
    } else {
      to(start)
    }
  }

  return found
}

// Coverage of each pixel in a box, from 0 to 1, filling by the nonzero rule.
const rasterize = (
  outline: ReadonlyArray<readonly [Point, Point]>,
  box: { left: number; top: number; width: number; height: number },
) => {
  const coverage = new Float64Array(box.width * box.height)

  for (let sub = 0; sub < box.height * rows; sub += 1) {
    const y = box.top + (sub + 0.5) / rows
    const row = Math.floor(sub / rows) * box.width
    // Where the sub-row crosses the outline, and in which direction.

    const crossings = outline
      .flatMap(([[x0, y0], [x1, y1]]) =>
        y0 !== y1 && y >= Math.min(y0, y1) && y < Math.max(y0, y1)
          ? [{ x: x0 + ((y - y0) / (y1 - y0)) * (x1 - x0) - box.left, winding: y1 > y0 ? 1 : -1 }]
          : [],
      )
      .toSorted((left, right) => left.x - right.x)

    let winding = 0

    for (const [index, crossing] of crossings.entries()) {
      winding += crossing.winding
      const next = crossings[index + 1]

      if (winding === 0 || next === undefined) continue

      // Adds the span [crossing.x, next.x) to the pixels it overlaps.
      for (let x = Math.floor(crossing.x); x < Math.ceil(next.x); x += 1) {
        const overlap = Math.min(x + 1, next.x) - Math.max(x, crossing.x)

        if (x >= 0 && x < box.width) coverage[row + x] = (coverage[row + x] ?? 0) + overlap / rows
      }
    }
  }

  return coverage
}

const glyphs = (font: opentype.Font, size: number) =>
  Object.fromEntries(
    characters.map((character) => {
      const glyph = font.charToGlyph(character)
      const path = glyph.getPath(0, 0, size)
      const bounds = path.getBoundingBox()
      const advance = Math.round((((glyph.advanceWidth ?? 0) * size) / font.unitsPerEm) * 100) / 100
      const empty = bounds.x2 <= bounds.x1

      if (empty) return [character, { advance, left: 0, top: 0, width: 0, height: 0, alpha: "" }]

      const box = {
        left: Math.floor(bounds.x1),
        top: Math.floor(bounds.y1),
        width: Math.ceil(bounds.x2) - Math.floor(bounds.x1),
        height: Math.ceil(bounds.y2) - Math.floor(bounds.y1),
      }

      const alpha = Array.from(rasterize(edges(path), box))
        .map((covered) => Math.round(Math.min(1, covered) * 15).toString(16))
        .join("")

      return [character, { advance, ...box, alpha }]
    }),
  )

const source = faces.map(({ name, weight, size }) => {
  const file = new URL(
    `../node_modules/@fontsource/geist/files/geist-latin-${weight}-normal.woff`,
    import.meta.url,
  )

  const bytes = readFileSync(file)

  // oxlint-disable-next-line import/no-named-as-default-member
  const font = opentype.parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  )

  const ascent = Math.round((font.ascender * size) / font.unitsPerEm)

  return `export const ${name}: Face = ${JSON.stringify({ size, ascent, glyphs: glyphs(font, size) })}\n`
})

writeFileSync(
  new URL("../src/card/faces.gen.ts", import.meta.url),
  `// Generated by scripts/glyphs.ts from Geist (SIL Open Font License 1.1,
// https://github.com/vercel/geist-font). Do not edit.
import type { Face } from "./font.ts"

${source.join("\n")}`,
)
