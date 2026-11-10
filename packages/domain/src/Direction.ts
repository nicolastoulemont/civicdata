import { Schema } from "effect"

import { kindOf, type Transform } from "./Transform.ts"

// Which way an indicator's values are better:
// - Higher: life expectancy, literacy.
// - Lower: unemployment, infant mortality, public debt.
// - Neutral: where reasonable people disagree, such as government spending,
//   tax revenue or fertility, and every indicator nobody has checked.
export const Direction = Schema.Literals(["Higher", "Lower", "Neutral"])

export type Direction = typeof Direction.Type

// Whether a chart of a transform keeps its indicator's direction: faster
// growth in debt is still worse, but a ratio of two indicators is better in
// neither direction.
const keeps: Record<ReturnType<typeof kindOf>, boolean> = {
  PerPerson: true,
  Growth: true,
  Index: true,
  Ratio: false,
}

// A chart's direction: its indicator's, after the chart's transform.
export const directionAfter = (direction: Direction, transform: Transform | undefined): Direction =>
  transform === undefined || keeps[kindOf(transform)] ? direction : "Neutral"
