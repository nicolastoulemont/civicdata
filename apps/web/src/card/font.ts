// A glyph as a bitmap. `alpha` holds one hex digit per pixel, row by row:
// how much of the pixel the glyph covers, from 0 to 15. `left` and `top`
// place the bitmap from the pen position on the baseline.
interface Glyph {
  readonly advance: number
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly alpha: string
}

// One font at one size, from scripts/glyphs.ts.
export interface Face {
  readonly size: number
  readonly ascent: number
  readonly glyphs: Readonly<Record<string, Glyph>>
}

// A character outside the face's set draws as "?". A non-breaking space,
// which some World Bank names hold, is a space.
export const glyph = (face: Face, character: string) =>
  face.glyphs[character === " " ? " " : character] ?? face.glyphs["?"]

// Faces hold single UTF-16 code units only, so splitting by unit is exact.
export const measure = (face: Face, text: string) =>
  text.split("").reduce((width, character) => width + (glyph(face, character)?.advance ?? 0), 0)

// The text, cut and ended with "…" when it is wider than `width`.
export const fit = (face: Face, text: string, width: number) => {
  if (measure(face, text) <= width) return text

  let cut = text.split("")

  while (cut.length > 0 && measure(face, `${cut.join("").trimEnd()}…`) > width)
    cut = cut.slice(0, -1)

  return `${cut.join("").trimEnd()}…`
}

// Breaks the text at spaces into at most `lines` lines no wider than `width`.
// The last line ends with "…" when the text does not fit.
export const wrap = (
  face: Face,
  text: string,
  { width, lines }: { width: number; lines: number },
) => {
  const result: Array<string> = []
  let line = ""

  for (const word of text.split(" ")) {
    const next = line === "" ? word : `${line} ${word}`

    // The last line takes every remaining word; `fit` then cuts it.
    if (line === "" || measure(face, next) <= width || result.length === lines - 1) {
      line = next
    } else {
      result.push(line)
      line = word
    }
  }

  return [...result, fit(face, line, width)]
}
