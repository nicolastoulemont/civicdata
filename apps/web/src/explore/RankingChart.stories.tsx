import type { Meta, StoryObj } from "@storybook/react-vite"

import { RankingChart } from "./RankingChart.tsx"
import { decode } from "./recorded/decode.ts"
import recorded from "./recorded/ranking.json"

const meta = {
  title: "Charts/Ranking",
  component: RankingChart,
  args: { resolved: decode(recorded) },
} satisfies Meta<typeof RankingChart>

export default meta

type Story = StoryObj<typeof meta>

// GDP per person in the G20's 19 member countries in 2023.
export const Default: Story = {}
