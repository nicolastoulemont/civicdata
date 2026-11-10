import type { Meta, StoryObj } from "@storybook/react-vite"

import { RankingMap } from "./RankingMap.tsx"
import { decode } from "./recorded/decode.ts"
import recorded from "./recorded/map.json"

const meta = {
  title: "Charts/Map",
  component: RankingMap,
  args: { resolved: decode(recorded) },
} satisfies Meta<typeof RankingMap>

export default meta

type Story = StoryObj<typeof meta>

// Life expectancy in every country in 2023.
export const Default: Story = {}
