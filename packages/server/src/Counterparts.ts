import { Dimensions, IndicatorId, type ResolvedView, type Transform } from "@civicdata/domain"
import { Schema } from "effect"

// One series: an indicator and, for SDMX, the value of each dimension.
interface Counterpart {
  readonly indicator: IndicatorId
  readonly dimensions: Dimensions
}

const pick = Schema.decodeSync(Dimensions)

const series = (indicator: string, dimensions: Record<string, string> = {}): Counterpart => ({
  indicator: IndicatorId.make(indicator),
  dimensions: pick(dimensions),
})

// Series from different sources that measure the same figure, so their values
// for a country and year should agree. Each says what it measures in its own
// way, which is why they sometimes do not.
const groups: ReadonlyArray<ReadonlyArray<Counterpart>> = [
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

const same = (left: Dimensions, right: Dimensions) => {
  const theirs = new Map<string, string>(Object.entries(right))

  return (
    Object.keys(left).length === theirs.size &&
    Object.entries(left).every(([id, code]) => theirs.get(id) === code)
  )
}

// The other sources' series for what a View shows of `shown`, when it shows
// one of the grouped series as published. A transformed value has no
// counterpart.
export const counterparts = (shown: {
  readonly indicator: IndicatorId
  readonly dimensions?: Dimensions | undefined
  readonly transform?: Transform | undefined
}): ReadonlyArray<Counterpart> => {
  if (shown.transform !== undefined) return []

  const group = groups.find((members) =>
    members.some(
      (member) =>
        member.indicator === shown.indicator && same(member.dimensions, shown.dimensions ?? {}),
    ),
  )

  return (group ?? []).filter((member) => member.indicator !== shown.indicator)
}

type Observations = ResolvedView["observations"]

// The other source's values that differ from the chart's for the same
// country and year by more than 1% of the larger: more than rounding.
export const disagreeing = (shown: Observations, other: Observations) => {
  const values = new Map(shown.map(({ country, year, value }) => [`${country}:${year}`, value]))

  return other.filter(({ country, year, value }) => {
    const ours = values.get(`${country}:${year}`)

    return (
      ours !== undefined &&
      Math.abs(ours - value) > 0.01 * Math.max(Math.abs(ours), Math.abs(value))
    )
  })
}
