import { Schema } from "effect"

// A source's own indicator code: a World Bank code such as "SP.POP.TOTL", or an
// SDMX dataflow as "agency,id,version", such as Eurostat's "ESTAT,UNE_RT_A,1.0"
// or the OECD's "OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0".
export const IndicatorId = Schema.String.check(
  Schema.isPattern(
    /^(?:[A-Za-z0-9][A-Za-z0-9._-]*|(?:ESTAT|OECD(?:\.[A-Z0-9]+)*),[A-Za-z0-9][A-Za-z0-9_@.-]*,[0-9]+(?:\.[0-9]+)*)$/,
  ),
).pipe(Schema.brand("IndicatorId"))

export type IndicatorId = typeof IndicatorId.Type

export const Indicator = Schema.Struct({
  id: IndicatorId,
  name: Schema.NonEmptyString,
  definition: Schema.String,
})
