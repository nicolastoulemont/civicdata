import { Direction, IndicatorId } from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { tables } from "./Catalog.ts"

interface Interface {
  // Which way an indicator's values are better; Neutral when nobody knows.
  readonly of: (indicator: IndicatorId) => Effect.Effect<Direction>
}

const decode = Schema.decodeUnknownOption(Direction)

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

// The one place a direction comes from: the hand-checked list, else the
// direction the catalog Workflow's model stored, else Neutral.
export class Directions extends Context.Service<Directions, Interface>()(
  "@civicdata/server/Directions",
) {
  // Needs a SqlClient over the catalog's database.
  static readonly layer = Layer.effect(
    Directions,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* tables

      const stored = SqlSchema.findOneOption({
        Request: IndicatorId,
        Result: Schema.Struct({ direction: Schema.String }),
        execute: (indicator) =>
          sql`SELECT direction FROM catalog_direction WHERE indicator = ${indicator}`,
      })

      const of = Effect.fn("Directions.of")(
        function* (indicator: IndicatorId) {
          const listed = checked.get(indicator)

          if (listed !== undefined) return listed

          // A stored value that is not a direction is Neutral.
          return Option.getOrElse(
            Option.flatMap(yield* stored(indicator), ({ direction }) => decode(direction)),
            () => "Neutral" as const,
          )
        },
        // The chart still draws without a direction.
        Effect.catchTags({
          SqlError: (error) =>
            Effect.logWarning("Reading a direction failed", error).pipe(
              Effect.as("Neutral" as const),
            ),
          SchemaError: Effect.die,
        }),
      )

      return Directions.of({ of })
    }).pipe(Effect.orDie),
  )

  // The hand-checked list alone, where there is no catalog database.
  static readonly listed = Layer.succeed(
    Directions,
    Directions.of({ of: (indicator) => Effect.succeed(checked.get(indicator) ?? "Neutral") }),
  )

  // D1 inside Workers (deployed, or under `alchemy dev`). Plain `pnpm dev`
  // runs in Node, where `cloudflare:workers` does not exist.
  static readonly live = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) =>
        env.DB === undefined
          ? Directions.listed
          : Directions.layer.pipe(Layer.provide(D1Client.layer({ db: env.DB }).pipe(Layer.orDie))),
      ),
      Effect.orElseSucceed(() => Directions.listed),
    ),
  )
}
