import { Trend } from "@civicdata/domain"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { Schema } from "effect"
import { fn } from "storybook/test"

import { decode } from "./recorded/decode.ts"
import history from "./recorded/trend-history.json"
import recorded from "./recorded/trend.json"
import { TrendChart } from "./TrendChart.tsx"

const meta = {
  title: "Charts/Trend",
  component: TrendChart,
  args: {
    resolved: decode(recorded),
    trend: Schema.decodeUnknownSync(Trend)(recorded.view),
  },
} satisfies Meta<typeof TrendChart>

export default meta

type Story = StoryObj<typeof meta>

// Life expectancy in five EU countries, 2003 to 2023.
export const Default: Story = {}

// The same trend with the window under it that picks its years over the
// whole history since 1960.
export const Picking: Story = {
  args: {
    history: {
      observations: decode(history).observations,
      same: true,
      onChange: fn(),
    },
  },
}
