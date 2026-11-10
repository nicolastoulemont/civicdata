import { Country, european } from "@civicdata/domain"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { Schema } from "effect"

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

// The same recording, keeping the European countries: the map of Europe
// with its insets.
const isCountry = Schema.is(Country)
const inEurope = (code: string) => isCountry(code) && european.has(code)

const europe = decode({
  ...recorded,
  view: { ...recorded.view, countries: recorded.view.countries.filter(inEurope) },
  observations: recorded.observations.filter((each) => inEurope(each.country)),
  missing: recorded.missing.filter(inEurope),
})

export const Europe: Story = { args: { resolved: europe } }

export const EuropeDark: Story = { args: { resolved: europe }, globals: { theme: "dark" } }
