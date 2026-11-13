import { Schema } from "effect"

import { Country } from "./Country.ts"
import { Study } from "./Finding.ts"
import { Https } from "./Politics.ts"
import { Year } from "./View.ts"

// A retrieved source passage. It describes an author's result, not consensus.
export const Paper = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  study: Study,
  quote: Schema.NonEmptyString,
  kind: Schema.Literals(["Description", "Association", "AuthorCausalEstimate"]),
  design: Schema.Literals(["Unknown", "Description", "Association", "AuthorCausalEstimate"]),
  population: Schema.NullOr(Schema.NonEmptyString),
  countries: Schema.Array(Country),
  periods: Schema.Array(
    Schema.Struct({ from: Year, to: Year }).check(
      Schema.makeFilter(({ from, to }) => from <= to || "from must not be after to"),
    ),
  ),
  page: Schema.Int.check(Schema.isGreaterThan(0)),
  url: Https,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  version: Schema.Literals(["publishedVersion", "acceptedVersion", "submittedVersion"]),
  licences: Schema.NonEmptyArray(Https),
  context: Schema.Array(
    Schema.Struct({
      page: Schema.Int.check(Schema.isGreaterThan(0)),
      text: Schema.NonEmptyString,
      role: Schema.Literals(["Method", "Limitation"]),
    }),
  ),
})

export interface Paper extends Schema.Schema.Type<typeof Paper> {}
