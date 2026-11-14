import { Code, Country, DimensionId, IndicatorId } from "@repo/domain"
import { Schema } from "effect"

// What the catalog knows of a publisher's datasets. File adapters write
// outlines themselves; for Eurostat and the OECD, sources/sdmx/parse.ts reads
// them from the files each publishes.

// A codelist, as "agency:id" without its version: "ESTAT:SEX", "OECD:CL_AGE".
// The OECD names a version in each structure that its "latest" codelist file
// may have replaced; the labels of a code rarely change between versions.
const Codelist = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.@-]+:[A-Za-z0-9_@-]+$/))

export type Codelist = typeof Codelist.Type

// One dimension of a dataset: the codes its series take, in the source's
// order, and the codelist that labels them, or null when the source does not
// say which. File adapters can label codes directly without a codelist.
export const Dimension = Schema.Struct({
  id: DimensionId,
  codelist: Schema.NullOr(Codelist),
  codes: Schema.NonEmptyArray(Code),
  labels: Schema.optionalKey(Schema.Record(Code, Schema.String)),
})

export interface Dimension extends Schema.Schema.Type<typeof Dimension> {}

// A dataset's outline: its dimensions besides country, frequency and time;
// whether it has annual values; which of our countries it covers; and its
// first and last year with an annual value, or with any value where the
// source does not tell them apart (the OECD). Null means unknown, while
// false annual or empty countries confirm exclusion. Countries and years are
// bounds for the whole dataset, not for each series: find_years gives those.
export const Outline = Schema.Struct({
  indicator: IndicatorId,
  dimensions: Schema.Array(Dimension),
  annual: Schema.NullOr(Schema.Boolean),
  countries: Schema.NullOr(Schema.Array(Country)),
  years: Schema.NullOr(Schema.Struct({ first: Schema.Int, last: Schema.Int })),
})

export interface Outline extends Schema.Schema.Type<typeof Outline> {}
