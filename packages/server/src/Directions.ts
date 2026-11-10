import { type Direction, IndicatorId } from "@civicdata/domain"
import { Context, Effect, Layer } from "effect"

interface Interface {
  // Which way an indicator's values are better; Neutral when nobody knows.
  readonly of: (indicator: IndicatorId) => Effect.Effect<Direction>
}

const entry = (indicator: string, direction: Direction) =>
  [IndicatorId.make(indicator), direction] as const

// Indicators people often ask about, each checked by hand. An SDMX dataset
// is listed only when every series it holds is better the same way: the
// OECD's life expectancy also holds the gap between women and men, and
// Eurostat's ILC_LI02 the share above each poverty threshold, so both stay
// off. Contested indicators stay off too: government spending, tax revenue,
// migration, fertility and inflation.
const checked: ReadonlyMap<IndicatorId, Direction> = new Map([
  // World Bank
  entry("SL.UEM.TOTL.ZS", "Lower"),
  entry("SL.UEM.1524.ZS", "Lower"),
  entry("SP.DYN.LE00.IN", "Higher"),
  entry("SP.DYN.IMRT.IN", "Lower"),
  entry("SH.DYN.MORT", "Lower"),
  entry("SH.STA.MMRT", "Lower"),
  entry("SI.POV.DDAY", "Lower"),
  entry("SI.POV.NAHC", "Lower"),
  entry("GC.DOD.TOTL.GD.ZS", "Lower"),
  entry("VC.IHR.PSRC.P5", "Lower"),
  entry("SE.ADT.LITR.ZS", "Higher"),
  entry("SE.ADT.1524.LT.ZS", "Higher"),
  entry("SE.PRM.NENR", "Higher"),
  entry("SE.SEC.NENR", "Higher"),
  entry("NY.GDP.PCAP.CD", "Higher"),
  entry("NY.GDP.PCAP.KD", "Higher"),
  entry("NY.GDP.PCAP.PP.KD", "Higher"),
  // The Worldwide Governance Indicators, as an estimate and as a score.
  entry("GOV_WGI_CC_EST", "Higher"),
  entry("GOV_WGI_CC_SC", "Higher"),
  entry("GOV_WGI_GE_EST", "Higher"),
  entry("GOV_WGI_GE_SC", "Higher"),
  entry("GOV_WGI_PV_EST", "Higher"),
  entry("GOV_WGI_PV_SC", "Higher"),
  entry("GOV_WGI_RL_EST", "Higher"),
  entry("GOV_WGI_RL_SC", "Higher"),
  entry("GOV_WGI_RQ_EST", "Higher"),
  entry("GOV_WGI_RQ_SC", "Higher"),
  entry("GOV_WGI_VA_EST", "Higher"),
  entry("GOV_WGI_VA_SC", "Higher"),
  // Eurostat
  entry("ESTAT,UNE_RT_A,1.0", "Lower"),
  entry("ESTAT,TIPSGO10,1.0", "Lower"),
  entry("ESTAT,SDG_17_40,1.0", "Lower"),
  entry("ESTAT,DEMO_MLEXPEC,1.0", "Higher"),
  entry("ESTAT,DEMO_MINFIND,1.0", "Lower"),
  entry("ESTAT,ILC_PEPS01N,1.0", "Lower"),
  entry("ESTAT,SDG_08_10,1.0", "Higher"),
  entry("ESTAT,SDG_04_10,1.0", "Lower"),
  // OECD
  entry("OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0", "Lower"),
  entry("OECD.ELS.HD,DSD_HEALTH_STAT@DF_MIM,1.1", "Lower"),
])

// The one place a direction comes from. The hand-checked list wins; a
// classification stored by the catalog Workflow will answer for the rest.
export class Directions extends Context.Service<Directions, Interface>()(
  "@civicdata/server/Directions",
) {
  static readonly layer = Layer.succeed(
    Directions,
    Directions.of({ of: (indicator) => Effect.succeed(checked.get(indicator) ?? "Neutral") }),
  )
}
