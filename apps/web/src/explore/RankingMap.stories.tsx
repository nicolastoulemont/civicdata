import {
  inYear,
  isRanked,
  Ranking,
  type Region,
  regions,
  type ResolvedView,
  Year,
} from "@civicdata/domain"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { RankingMap } from "./RankingMap.tsx"
import change from "./recorded/change.json"
import { decode } from "./recorded/decode.ts"
import overTime from "./recorded/map-over-time.json"
import recorded from "./recorded/map.json"
import population from "./recorded/population.json"
import { bands } from "./sheet.ts"

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

// A map of one year of a change recording, keeping its values that year.
const yearOf = (recording: typeof change | typeof population, year: number): ResolvedView => {
  const resolved = decode(recording)

  return {
    ...resolved,
    view: Ranking.make({
      indicator: resolved.view.indicator,
      countries: resolved.view.countries,
      year: Year.make(year),
      as: "Map",
    }),
    observations: resolved.observations.filter((each) => each.year === year),
  }
}

// Life expectancy is better higher: the longest lives shade green.
export const HigherIsBetter: Story = { args: { resolved: within("europe") } }

export const HigherIsBetterDark: Story = {
  args: { resolved: within("europe") },
  globals: { theme: "dark" },
}

// Unemployment in the EU in 2023 is better lower: the lowest rates shade green.
export const LowerIsBetter: Story = { args: { resolved: yearOf(change, 2023) } }

export const LowerIsBetterDark: Story = {
  args: { resolved: yearOf(change, 2023) },
  globals: { theme: "dark" },
}

// Population is neither: the map keeps its blue.
export const Neutral: Story = { args: { resolved: yearOf(population, 2023) } }

export const NeutralDark: Story = {
  args: { resolved: yearOf(population, 2023) },
  globals: { theme: "dark" },
}

// Life expectancy in Africa from 1990 to 2023, shown in 2023 on value bands
// fixed across the span.
const moving = decode(overTime)

const overTimeArgs = {
  resolved: isRanked(moving) ? inYear(moving, moving.view.year) : moving,
  bands: bands(moving.observations),
}

export const OverTime: Story = { args: overTimeArgs }

export const OverTimeDark: Story = { args: overTimeArgs, globals: { theme: "dark" } }
