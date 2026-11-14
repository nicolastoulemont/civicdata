import { ChartIndex, TurnIndex, View } from "@repo/domain"
import { Schema } from "effect"

// A chart a person changed since the model last heard of it: its turn, its
// place among the turn's charts, and the chart the model knows there.
export const Edit = Schema.Struct({ turn: TurnIndex, chart: ChartIndex, known: View })

export type Edit = typeof Edit.Type
