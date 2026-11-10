import { Change } from "@civicdata/domain"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { Schema } from "effect"

import { ChangeChart } from "./ChangeChart.tsx"
import recorded from "./recorded/change.json"
import { decode } from "./recorded/decode.ts"

const meta = {
  title: "Charts/Change",
  component: ChangeChart,
  args: {
    resolved: decode(recorded),
    change: Schema.decodeUnknownSync(Change)(recorded.view),
  },
} satisfies Meta<typeof ChangeChart>

export default meta

type Story = StoryObj<typeof meta>

// Unemployment in the 27 EU countries in 2013 and 2023.
export const Default: Story = {}
