import { Schema } from "effect"

import { Country } from "./Country.ts"
import { Dimensions } from "./Dimension.ts"
import { IndicatorId } from "./Source.ts"

export { IndicatorId } from "./Source.ts"

export const Indicator = Schema.Struct({
  id: IndicatorId,
  name: Schema.NonEmptyString,
  definition: Schema.String,
})

// One section of what a source writes about its data, null when the source
// wrote none.
const Section = Schema.NullOr(Schema.NonEmptyString)

const provenance = { url: Schema.String, retrievedAt: Schema.DateTimeUtc }

// What the World Bank writes about a series beyond its definition: why it
// matters ("Development relevance"), its limitations ("Limitations and
// exceptions"), how it is measured ("Statistical concept and methodology")
// and who produced it, with their page ("Source"), such as the Worldwide
// Governance Indicators' page, which documents their method.
const worldBank = {
  indicator: IndicatorId,
  relevance: Section,
  limitations: Section,
  methodology: Section,
  producer: Schema.NullOr(
    Schema.Struct({
      name: Schema.NonEmptyString,
      url: Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/)),
    }),
  ),
  ...provenance,
}

// The sections of a Eurostat dataset's reference metadata (ESMS) that say how
// its figures are measured and how far they compare: "Statistical concepts
// and definitions", "Overall accuracy", "Comparability - geographical",
// "Comparability - over time", where Eurostat explains its breaks in series,
// and "Coherence - cross domain", where it compares them with other
// statistics of the same thing.
const eurostat = {
  indicator: IndicatorId,
  concepts: Section,
  accuracy: Section,
  comparability: Schema.Struct({ countries: Section, time: Section }),
  coherence: Section,
  ...provenance,
}

// A note the OECD attaches to part of a dataflow: one country, or every
// country when `country` is null, and the series whose dimensions take the
// values in `series`, every series when it is empty. Its sections are
// "Statistical concepts and definitions", "Quality assessment", where the
// OECD records breaks in series, "Recommended uses and limitations" and
// "Comment".
const OecdNote = Schema.Struct({
  country: Schema.NullOr(Country),
  series: Dimensions,
  concepts: Section,
  quality: Section,
  limitations: Section,
  comment: Section,
})

// What a source writes about an indicator beyond its definition, tagged by
// the source: each publishes different sections.
export const IndicatorNotes = Schema.TaggedUnion({
  "World Bank": worldBank,
  Eurostat: eurostat,
  OECD: { indicator: IndicatorId, notes: Schema.Array(OecdNote), ...provenance },
})

export type IndicatorNotes = typeof IndicatorNotes.Type
