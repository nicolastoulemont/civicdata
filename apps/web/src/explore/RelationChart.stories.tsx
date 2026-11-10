import type { Meta, StoryObj } from "@storybook/react-vite"

import { decode } from "./recorded/decode.ts"
import recorded from "./recorded/relation.json"
import { RelationChart } from "./RelationChart.tsx"

const resolved = decode(recorded)

if (!("against" in resolved)) throw new Error("recorded/relation.json holds no relation")

const meta = {
  title: "Charts/Relation",
  component: RelationChart,
  args: { resolved },
} satisfies Meta<typeof RelationChart>

export default meta

type Story = StoryObj<typeof meta>

// Life expectancy against GDP per person in the 38 OECD members in 2022.
export const Default: Story = {}
