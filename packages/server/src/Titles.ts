import type { Indicator } from "@openfacts/domain"

import { titles } from "./titles.gen.ts"

// "GDP per capita, PPP (constant 2021 international $)" → ["2021"].
const numbers = (text: string) => text.match(/\d+(?:[.,]\d+)*/g) ?? []

// Whether a plain title can stand for an indicator with this official name:
// at most 80 characters of printable ASCII, the en dash, "·" or "…" (the
// faces the link-preview card draws), and no number the name lacks. A title
// rewords the name; it never adds a figure the source did not publish.
export const fits = (title: string, name: string) => {
  const allowed = new Set(numbers(name))

  return (
    title.length > 0 &&
    title.length <= 80 &&
    /^[\x20-\x7E–·…]+$/u.test(title) &&
    numbers(title).every((number) => allowed.has(number))
  )
}

// The chart's heading: the indicator's plain title, or its official name when
// it has none, or when the source renamed it so that the title no longer fits.
export const titleOf = (indicator: typeof Indicator.Type) => {
  const title = titles.get(indicator.id)

  return title !== undefined && fits(title, indicator.name) ? title : indicator.name
}
