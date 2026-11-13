import type { ChartIndex, View } from "@repo/domain"

// A chart a person changed since the model last heard of it: the question
// whose answer holds it, its place in that answer, and the one on screen.
export interface Changed {
  readonly question: string
  readonly chart: ChartIndex
  readonly view: View
}
