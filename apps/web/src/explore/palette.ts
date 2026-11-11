import type { Country, Direction } from "@civicdata/domain"
import { Match } from "effect"

import { colors } from "./colors.gen.ts"

/**
 * The one colour of a chart that colours no country, a theme-mixed gray, or
 * the poles and grey midpoint of a chart whose indicator has a direction.
 */
type Slot = 1 | "other" | "faint" | "better" | "worse" | "even"

export const fill = (slot: Slot) => `var(--chart-${slot})`

// A country's own colour, the same in every chart, from its flag. The page's
// color-scheme picks the light or dark version.
export const color = (country: Country) =>
  `light-dark(${colors[country].light}, ${colors[country].dark})`

/** The five rank bands, from faint blue to solid blue. */
const blend = (shade: number) =>
  `color-mix(in oklab, ${fill(1)} ${15 + shade * 21.25}%, ${fill("faint")})`

// Five steps from the worse pole (0) through grey (2) to the better pole (4).
const diverge = (step: number) => {
  const pole = fill(step < 2 ? "worse" : "better")

  return Match.value(Math.abs(step - 2)).pipe(
    Match.when(0, () => fill("even")),
    Match.when(1, () => `color-mix(in oklab, ${pole} 50%, ${fill("even")})`),
    Match.orElse(() => pole),
  )
}

// A map's colour for each of its five bands, lowest values first: blue from
// faint to solid for a neutral indicator; otherwise from the worse colour
// through grey to the better one, the other way round when lower is better.
export const shading = (direction: Direction) => (shade: number) =>
  Match.value(direction).pipe(
    Match.when("Neutral", () => blend(shade)),
    Match.when("Higher", () => diverge(shade)),
    Match.when("Lower", () => diverge(4 - shade)),
    Match.exhaustive,
  )
