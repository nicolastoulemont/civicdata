import type { View } from "@civicdata/domain"
import { Match } from "effect"
import { ChartColumn, ChartLine } from "lucide-react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

import { asRanking, asTrend } from "./edits.ts"

const kind = (view: View) =>
  Match.valueTags(view, { Trend: () => "trend", Ranking: () => "ranking" })

// Lines over years, or bars ranking one year.
export const ChartType = ({ view, onChange }: { view: View; onChange: (view: View) => void }) => (
  <ToggleGroup
    aria-label="Chart type"
    variant="outline"
    value={[kind(view)]}
    onValueChange={(next: Array<string>) => {
      if (next.includes("trend")) onChange(asTrend(view))

      if (next.includes("ranking")) onChange(asRanking(view))
    }}
  >
    <ToggleGroupItem value="trend" aria-label="Line chart over years">
      <ChartLine aria-hidden />
      Line
    </ToggleGroupItem>
    <ToggleGroupItem value="ranking" aria-label="Bar chart ranking one year">
      <ChartColumn aria-hidden />
      Bar
    </ToggleGroupItem>
  </ToggleGroup>
)
