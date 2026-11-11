import { Change, IndicatorId, Year } from "@openfacts/domain"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { Schema } from "effect"

import { ChangeChart } from "./ChangeChart.tsx"
import recorded from "./recorded/change.json"
import { decode } from "./recorded/decode.ts"
import lives from "./recorded/map-over-time.json"
import population from "./recorded/population.json"

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

// Unemployment in the 27 EU countries in 2013 and 2023. Lower is better, so
// each fall is green.
export const Default: Story = {}

export const Dark: Story = { globals: { theme: "dark" } }

// Life expectancy in West Africa in 2019 and 2021. Higher is better, so the
// few rises are green and the falls red.
const westAfrica = [
  "BEN",
  "BFA",
  "CIV",
  "CPV",
  "GHA",
  "GIN",
  "GMB",
  "GNB",
  "LBR",
  "MLI",
  "MRT",
  "NER",
  "NGA",
  "SEN",
  "SLE",
  "TGO",
] as const

const shown = new Set<string>(westAfrica)

const between = Change.make({
  indicator: IndicatorId.make(lives.view.indicator),
  countries: westAfrica,
  from: Year.make(2019),
  to: Year.make(2021),
})

const higher = {
  resolved: decode({
    ...lives,
    view: Schema.encodeSync(Change)(between),
    observations: lives.observations.filter(
      (each) => shown.has(each.country) && (each.year === 2019 || each.year === 2021),
    ),
    missing: [],
    breaks: [],
  }),
  change: between,
}

export const HigherIsBetter: Story = { args: higher }

export const HigherIsBetterDark: Story = { args: higher, globals: { theme: "dark" } }

// Population of the 27 EU countries in 2013 and 2023: neither way is better,
// so the change keeps its blue.
const neutral = {
  resolved: decode(population),
  change: Schema.decodeUnknownSync(Change)(population.view),
}

export const Neutral: Story = { args: neutral }

export const NeutralDark: Story = { args: neutral, globals: { theme: "dark" } }
