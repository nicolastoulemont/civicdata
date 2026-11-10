import type { Country } from "@civicdata/domain"

import { colors } from "./colors.gen.ts"

/** The one colour of a chart that colours no country, or a theme-mixed gray. */
type Slot = 1 | "other" | "faint"

export const fill = (slot: Slot) => `var(--chart-${slot})`

// A country's own colour, the same in every chart, from its flag. The page's
// color-scheme picks the light or dark version.
export const color = (country: Country) =>
  `light-dark(${colors[country].light}, ${colors[country].dark})`

/** The five rank bands, from faint blue to solid blue. */
export const blend = (shade: number) =>
  `color-mix(in oklab, ${fill(1)} ${15 + shade * 21.25}%, ${fill("faint")})`
