import { isRanked, type Ranked, type ResolvedView, type Year } from "@civicdata/domain"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { RankedChart } from "./RankedChart.tsx"
import { decode } from "./recorded/decode.ts"
import map from "./recorded/map-over-time.json"
import ranking from "./recorded/ranking-over-time.json"

const ranked = (resolved: ResolvedView): Ranked => {
  if (!isRanked(resolved)) throw new Error("The recording is not a ranking")

  return resolved
}

interface SavingProps {
  resolved: Ranked
}

// Keeps the year the slider lets go on, as the page saves it in the View.
const Saving = ({ resolved }: SavingProps) => {
  const [year, setYear] = useState<Year>(resolved.view.year)

  return (
    <RankedChart
      resolved={resolved}
      moving={{ year, agent: resolved.view.year, onYear: setYear }}
    />
  )
}

const meta = {
  title: "Charts/Over time",
  component: Saving,
  args: { resolved: ranked(decode(ranking)) },
} satisfies Meta<typeof Saving>

export default meta

type Story = StoryObj<typeof meta>

// GDP per person in the G20's 19 member countries, 2000 to 2023, on an axis
// fixed across those years.
export const Ranking: Story = {}

export const RankingDark: Story = { globals: { theme: "dark" } }

// Life expectancy across Africa, 1990 to 2023, shaded on bands fixed across
// those years.
export const Map: Story = { args: { resolved: ranked(decode(map)) } }

export const MapDark: Story = {
  args: { resolved: ranked(decode(map)) },
  globals: { theme: "dark" },
}
