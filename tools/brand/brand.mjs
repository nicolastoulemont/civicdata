// Draws the openfacts mark and logo into every file that carries them: the
// favicons, app icons and web manifest in apps/web/public, the link preview
// (preview.png), and the README logos and GitHub social preview in docs/brand.
// Text is Geist outlines, so the SVGs render without the font. The preview
// text is the English site description. Run with `pnpm brand` after changing
// the mark, its colours or that description. apps/web/src/Mark.tsx draws the
// same mark in the app.
import { readFileSync, writeFileSync } from "node:fs"

import resvg from "@resvg/resvg-js"
// opentype.js ships CommonJS, which Node exposes as a default export only.
// oxlint-disable-next-line import/default
import opentype from "opentype.js"

const root = new URL("../../", import.meta.url)
const at = (path) => new URL(path, root)

// The Geist faces apps/web/scripts/glyphs.ts reads, from the web package.
const font = (weight) => {
  const bytes = readFileSync(
    at(`apps/web/node_modules/@fontsource/geist/files/geist-latin-${weight}-normal.woff`),
  )

  // oxlint-disable-next-line import/no-named-as-default-member
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

const semibold = font(600)
const regular = font(400)

// The light and dark values of --foreground and --brand in styles.css.
const ink = "#171717"
const paper = "#f5f5f5"
const brand = "#4f46e5"
const brandDark = "#818cf8"
const muted = "#737373"

const frame = "M5 11.5V5H11.5M20.5 5H27V11.5M27 20.5V27H20.5M11.5 27H5V20.5"

const mark = (corners, dot) =>
  `<path d="${frame}" fill="none" stroke="${corners}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="16" r="4.6" fill="${dot}"/>`

const place = (x, y, size, body) =>
  `<g transform="translate(${x} ${y}) scale(${size / 32})">${body}</g>`

const svg = (width, height, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${body}</svg>\n`

const png = (source, width) =>
  new resvg.Resvg(source, { fitTo: { mode: "width", value: width } }).render().asPng()

const round = (value) => Math.round(value * 100) / 100

const outline = (path) =>
  path.commands
    .map((command) => {
      if (command.type === "M" || command.type === "L")
        return `${command.type}${round(command.x)} ${round(command.y)}`

      if (command.type === "Q")
        return `Q${round(command.x1)} ${round(command.y1)} ${round(command.x)} ${round(command.y)}`

      if (command.type === "C")
        return `C${round(command.x1)} ${round(command.y1)} ${round(command.x2)} ${round(command.y2)} ${round(command.x)} ${round(command.y)}`

      return "Z"
    })
    .join("")

// A line of text as one path per glyph, with Geist's kerning and a tracking in em.
const line = (face, text, { x, y, size, tracking = 0 }) => {
  const glyphs = face.stringToGlyphs(text)
  const scale = size / face.unitsPerEm
  let cursor = x
  let paths = ""

  for (const [index, glyph] of glyphs.entries()) {
    paths += `<path d="${outline(glyph.getPath(cursor, y, size))}"/>`
    cursor += glyph.advanceWidth * scale + tracking * size
    const next = glyphs[index + 1]

    if (next !== undefined) cursor += face.getKerningValue(glyph, next) * scale
  }

  return { paths, width: cursor - x - tracking * size }
}

// Words packed into lines no wider than `width`.
const wrap = (face, text, { size, width }) => {
  const lines = []

  for (const word of text.split(" ")) {
    const last = lines.at(-1)
    const joined = `${last} ${word}`

    if (last !== undefined && line(face, joined, { x: 0, y: 0, size }).width <= width) {
      lines[lines.length - 1] = joined
    } else {
      lines.push(word)
    }
  }

  return lines
}

// The mark and the wordmark, the mark centred a third of an em above the baseline.
const logo = ({ corners, dot, size }) => {
  const side = size * 0.92
  const gap = size * 0.28
  const word = line(semibold, "openfacts", { x: side + gap, y: size, size, tracking: -0.045 })
  const centre = size - size * 0.33

  return {
    width: Math.ceil(side + gap + word.width + size * 0.06),
    height: Math.ceil(size * 1.25),
    body: `${place(0, centre - side / 2, side, mark(corners, dot))}<g fill="${corners}">${word.paths}</g>`,
  }
}

const description = JSON.parse(
  readFileSync(at("apps/web/src/locales/en-US/common.json"), "utf8"),
).siteDescription

// A white card: the logo, the description, and the sources the site charts.
const preview = (width, height) => {
  const left = 104
  const top = Math.round((height - 630) / 2)
  const big = logo({ corners: ink, dot: brand, size: 104 })
  const rows = wrap(regular, description, { size: 34, width: 900 })

  const text = rows
    .map((row, index) => line(regular, row, { x: left, y: top + 330 + index * 48, size: 34 }).paths)
    .join("")

  const sources = line(regular, "Data: World Bank, Eurostat, OECD, INSEE", {
    x: left,
    y: top + 330 + (rows.length - 1) * 48 + 76,
    size: 26,
  })

  return svg(
    width,
    height,
    `<rect width="${width}" height="${height}" fill="#fff"/><rect x="40.5" y="40.5" width="${width - 81}" height="${height - 81}" rx="24" fill="#fff" stroke="#e5e5e5"/><g transform="translate(${left - 4} ${top + 130})">${big.body}</g><g fill="${muted}">${text}</g><g fill="${ink}">${sources.paths}</g>`,
  )
}

const write = (path, content) => {
  writeFileSync(at(path), content)
  console.log(`wrote ${path}`)
}

// A favicon that follows the browser's colour scheme.
write(
  "apps/web/public/favicon.svg",
  svg(
    32,
    32,
    `<style>.c{stroke:${ink}}.d{fill:${brand}}@media (prefers-color-scheme:dark){.c{stroke:${paper}}.d{fill:${brandDark}}}</style><path class="c" d="${frame}" fill="none" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><circle class="d" cx="16" cy="16" r="4.6"/>`,
  ),
)

// favicon.ico: 16, 32 and 48 px PNGs in one ICO container, drawn for a light tab.
const sizes = [16, 32, 48]
const images = sizes.map((size) => png(svg(32, 32, mark(ink, brand)), size))
const header = Buffer.alloc(6 + 16 * images.length)

header.writeUInt16LE(1, 2)

header.writeUInt16LE(images.length, 4)

let offset = header.length

for (const [index, image] of images.entries()) {
  const entry = 6 + 16 * index
  header.writeUInt8(sizes[index], entry)
  header.writeUInt8(sizes[index], entry + 1)
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(image.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += image.length
}

write("apps/web/public/favicon.ico", Buffer.concat([header, ...images]))

// App icons: a full-bleed ink square with the mark inside the maskable safe zone.
const tile = svg(
  512,
  512,
  `<rect width="512" height="512" fill="${ink}"/>${place(106, 106, 300, mark("#fff", brandDark))}`,
)

write("apps/web/public/apple-touch-icon.png", png(tile, 180))

write("apps/web/public/icon-192.png", png(tile, 192))

write("apps/web/public/icon-512.png", png(tile, 512))

write(
  "apps/web/public/site.webmanifest",
  `${JSON.stringify(
    {
      name: "openfacts",
      short_name: "openfacts",
      description,
      start_url: "/",
      background_color: "#ffffff",
      theme_color: ink,
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    null,
    2,
  )}\n`,
)

write("apps/web/public/preview.png", png(preview(1200, 630), 1200))

for (const [scheme, corners, dot] of [
  ["light", ink, brand],
  ["dark", paper, brandDark],
]) {
  const small = logo({ corners, dot, size: 48 })
  write(`docs/brand/logo-${scheme}.svg`, svg(small.width, small.height, small.body))
  write(`docs/brand/mark-${scheme}.svg`, svg(32, 32, mark(corners, dot)))
}

// GitHub's social preview, uploaded by hand in the repository's settings.
write("docs/brand/social-preview.png", png(preview(1280, 640), 1280))
