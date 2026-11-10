import { type Region, regions } from "@civicdata/domain"
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

// The same recording, keeping one region's countries: that region's map.
const within = (id: Region["id"]) => {
  const region = regions.find((each) => each.id === id)
  const holds = (code: string) => region?.countries.some((country) => country === code) ?? false

  return decode({
    ...recorded,
    view: { ...recorded.view, countries: recorded.view.countries.filter(holds) },
    observations: recorded.observations.filter((each) => holds(each.country)),
    missing: recorded.missing.filter(holds),
  })
}

// Europe with the EU's outermost regions in insets.
export const Europe: Story = { args: { resolved: within("europe") } }

export const EuropeDark: Story = {
  args: { resolved: within("europe") },
  globals: { theme: "dark" },
}

// North America with Hawaii in an inset.
export const NorthAmerica: Story = { args: { resolved: within("north-america") } }

export const SoutheastAsia: Story = { args: { resolved: within("southeast-asia") } }

export const Caribbean: Story = { args: { resolved: within("caribbean") } }

export const NortheastAsia: Story = { args: { resolved: within("northeast-asia") } }
