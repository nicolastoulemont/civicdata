import { Schema } from "effect"

// A deposit's metadata: whether it is an author manuscript, and its PDF,
// which a deposit may lack.
export const Deposit = Schema.Struct({
  is_manuscript: Schema.Boolean,
  pdf_url: Schema.NullOr(
    Schema.String.check(Schema.isPattern(/^s3:\/\/pmc-oa-opendata\/PMC\d+\.\d+\/[^?\s]+\.pdf/)),
  ),
})
