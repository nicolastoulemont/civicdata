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

// What the World Bank says about an indicator beyond its definition: why it
// matters ("Development relevance"), its limitations ("Limitations and
// exceptions") and who produced it, with their page ("Source"), such as the
// Worldwide Governance Indicators' page, which documents their method. Each
// is null when the World Bank has written none.
export const IndicatorNotes = Schema.Struct({
  indicator: IndicatorId,
  relevance: Schema.NullOr(Schema.NonEmptyString),
  limitations: Schema.NullOr(Schema.NonEmptyString),
  producer: Schema.NullOr(
    Schema.Struct({
      name: Schema.NonEmptyString,
      url: Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/)),
    }),
  ),
  url: Schema.String,
  retrievedAt: Schema.DateTimeUtc,
})

export interface IndicatorNotes extends Schema.Schema.Type<typeof IndicatorNotes> {}
