import type { View } from "@civicdata/domain"
import { ChartColumn, ChartGantt, ChartLine, ChartScatter, Earth } from "lucide-react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

import { chartOf, withChart } from "./edits.ts"

const choices = [
  { value: "Trend", label: "Line", description: "Line chart over years", Icon: ChartLine },
  { value: "Ranking", label: "Bar", description: "Bar chart ranking one year", Icon: ChartColumn },
  { value: "Map", label: "Map", description: "World map ranking one year", Icon: Earth },
  { value: "Change", label: "Change", description: "Change between two years", Icon: ChartGantt },
  {
    value: "Relation",
    label: "Scatter",
    description: "Scatter plot of one indicator against another",
    Icon: ChartScatter,
  },
] as const

interface ChartTypeProps {
  view: View
  onChange: (view: View) => void
}

// How the View is drawn: lines over years, bars or a map ranking one year, a
// change between two years, or one indicator against another.
export const ChartType = ({ view, onChange }: ChartTypeProps) => (
  <ToggleGroup
    aria-label="Chart type"
    className="flex-wrap"
    variant="outline"
    value={[chartOf(view)]}
    onValueChange={(next: Array<string>) => {
      const picked = choices.find((choice) => next.includes(choice.value))

      if (picked !== undefined) onChange(withChart(view, picked.value))
    }}
  >
    {choices.map(({ value, label, description, Icon }) => (
      <ToggleGroupItem key={value} value={value} aria-label={description}>
        <Icon aria-hidden />
        {label}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
)
