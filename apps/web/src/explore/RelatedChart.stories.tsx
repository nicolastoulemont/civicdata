import type { Related, ResolvedView, Year } from "@repo/domain"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { decode } from "./recorded/decode.ts"
import recorded from "./recorded/relation-over-time.json"
import { RelatedChart } from "./RelatedChart.tsx"

const related = (resolved: ResolvedView): Related => {
  if (!("against" in resolved)) throw new Error("The recording is not a relation")

  return resolved
}

interface SavingProps {
  resolved: Related
}

// Keeps the year the slider lets go on or play pauses on, as the page saves
// it in the View.
const Saving = ({ resolved }: SavingProps) => {
  const [year, setYear] = useState<Year>(resolved.view.year)

  return (
    <RelatedChart
      resolved={resolved}
      moving={{ year, agent: resolved.view.year, onYear: setYear }}
    />
  )
}

const meta = {
  title: "Charts/Relation over time",
  component: Saving,
  args: { resolved: related(decode(recorded)) },
} satisfies Meta<typeof Saving>

export default meta

type Story = StoryObj<typeof meta>

// Life expectancy against GDP per person in the G20's 19 member countries,
// 1990 to 2022: paused, each country's path to the year shown.
export const Default: Story = {}

export const Dark: Story = { globals: { theme: "dark" } }
