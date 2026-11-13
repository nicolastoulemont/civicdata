import { Dimensions, IndicatorId, pathOf, type SeriesKey, type Transform } from "@repo/domain"
import { Schema } from "effect"

const pick = Schema.decodeSync(Dimensions)

const series = (indicator: string, dimensions: Record<string, string> = {}): SeriesKey => ({
  indicator: IndicatorId.make(indicator),
  dimensions: pick(dimensions),
})

// Series from different sources that measure the same figure, so their values
// for a country and year should agree. Each says what it measures in its own
// way, which is why they sometimes do not.
const groups: ReadonlyArray<ReadonlyArray<SeriesKey>> = [
  // Population: the World Bank's at mid-year, Eurostat's on 1 January.
  [series("SP.POP.TOTL"), series("ESTAT,TPS00001,1.0")],
  // Unemployment as a share of the labour force: the World Bank's ILO
  // estimate for ages 15 and over, Eurostat's survey for ages 15 to 74, the
  // OECD's for ages 15 and over, neither seasonally nor calendar adjusted.
  [
    series("SL.UEM.TOTL.ZS"),
    series("ESTAT,UNE_RT_A,1.0", { age: "Y15-74", unit: "PC_ACT", sex: "T" }),
    series("OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0", {
      ADJUSTMENT: "N",
      SEX: "_T",
      AGE: "Y_GE15",
    }),
  ],
]

// The other sources' series for what a View shows of `shown`, when it shows
// one of the grouped series as published. A transformed value has no
// counterpart.
export const counterparts = (shown: {
  readonly indicator: IndicatorId
  readonly dimensions?: Dimensions | undefined
  readonly transform?: Transform | undefined
}): ReadonlyArray<SeriesKey> => {
  if (shown.transform !== undefined) return []

  const path = pathOf({ indicator: shown.indicator, dimensions: shown.dimensions ?? {} })
  const group = groups.find((members) => members.some((member) => pathOf(member) === path))

  return (group ?? []).filter((member) => member.indicator !== shown.indicator)
}
