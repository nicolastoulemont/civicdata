import { Schema } from "effect"

import { Country } from "./Country.ts"
import { Study } from "./Finding.ts"
import { Https } from "./Politics.ts"
import { Year } from "./View.ts"

const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))

const Page = Schema.Int.check(Schema.isGreaterThan(0))

// A retrieved source passage. It describes an author's result, not consensus.
// `copy` is the paper store's id of the copy the quote comes from, which a
// saved turn checks for withdrawal. Citations saved before the paper store
// have none.
export const Paper = Schema.Struct({
  id: Digest,
  copy: Schema.optionalKey(Digest),
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
  page: Page,
  url: Https,
  sha256: Digest,
  version: Schema.Literals(["publishedVersion", "acceptedVersion", "submittedVersion"]),
  licences: Schema.NonEmptyArray(Https),
  context: Schema.Array(
    Schema.Struct({
      page: Page,
      text: Schema.NonEmptyString,
      role: Schema.Literals(["Method", "Limitation"]),
    }),
  ),
})

export interface Paper extends Schema.Schema.Type<typeof Paper> {}

// Why a copy's text was taken out of the paper store: its rights, or the
// paper's retraction.
export const Withdrawal = Schema.Literals(["Rights", "Retraction"])

export type Withdrawal = typeof Withdrawal.Type

// A cited paper whose copy was withdrawn after an answer cited it. Its card
// keeps the study and says why, never the quote or the context.
export const Withdrawn = Schema.Struct({
  id: Paper.fields.id,
  study: Study,
  url: Https,
  reason: Withdrawal,
})

// A paper a search found that no reviewed annotation covers yet: something
// to read, never evidence, and never cited. It has no scope: its year is
// when it was published, and says nothing of the years or people it
// studies. `copy` is the admitted copy the store holds, with its reuse
// licences and the passage the search matched, or null for a paper the
// store holds only the bibliography of.
export const Reading = Schema.Struct({
  id: Digest,
  study: Study.mapFields((fields) => ({
    ...fields,
    authors: Schema.Array(Schema.NonEmptyString),
    publisher: Schema.NullOr(Schema.NonEmptyString),
  })),
  copy: Schema.NullOr(
    Schema.Struct({
      url: Https,
      licences: Schema.NonEmptyArray(Https),
      excerpt: Schema.NullOr(Schema.Struct({ page: Page, text: Schema.NonEmptyString })),
    }),
  ),
})

export interface Reading extends Schema.Schema.Type<typeof Reading> {}
