import { Schema } from "effect"

import { Dimensions } from "./Dimension.ts"
import { IndicatorId } from "./Indicator.ts"

// One series: an indicator and the value of each of its dimensions. A World
// Bank indicator is one series, with no dimensions; an SDMX dataflow holds a
// series for each combination of its dimensions' values.
export const SeriesKey = Schema.Struct({ indicator: IndicatorId, dimensions: Dimensions })

export interface SeriesKey extends Schema.Schema.Type<typeof SeriesKey> {}

// The dimensions' values as text, sorted by dimension, such as
// "age=Y15-74,sex=T,unit=PC_ACT"; empty for none.
export const codesOf = (dimensions: Dimensions) =>
  Object.entries(dimensions)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([dimension, code]) => `${dimension}=${code}`)
    .join(",")

// The key as a path, such as "ESTAT,UNE_RT_A,1.0/age=Y15-74,sex=T,unit=PC_ACT".
// A series without dimensions is its indicator. Two keys name the same series
// when their paths are equal.
export const pathOf = ({ indicator, dimensions }: SeriesKey) => {
  const codes = codesOf(dimensions)

  return codes === "" ? indicator : `${indicator}/${codes}`
}
