import { Schema } from "effect"

import { IndicatorId } from "./Indicator.ts"
import { Https, Scope, Slug } from "./Politics.ts"
import { Year } from "./View.ts"

// A study behind a finding: who wrote it, each author as "Last, First" or
// an organisation by its name, when, where it appeared, its DOI
// when it has one, and a copy anyone can read. All of it describes the
// version `url` links, e.g. a working paper rather than its journal version.
export const Study = Schema.Struct({
  authors: Schema.NonEmptyArray(Schema.NonEmptyString),
  year: Schema.Int.check(Schema.isBetween({ minimum: 1900, maximum: 2100 })),
  title: Schema.NonEmptyString,
  publisher: Schema.NonEmptyString,
  doi: Schema.NullOr(Schema.String.check(Schema.isPattern(/^10\.\d{4,9}\/\S+$/))),
  url: Https,
})

export interface Study extends Schema.Schema.Type<typeof Study> {}

// An author's last name, or an organisation's name.
const surname = (author: string) => author.split(",")[0] ?? author

// A study as a sentence cites it: "Blanchard and Leigh (2013)", "Dustmann
// et al. (2014)", "OECD (2013)".
export const bylineOf = ({ authors: [first, ...rest], year }: Study) => {
  const [second] = rest

  return `${surname(first)}${
    second === undefined ? "" : rest.length === 1 ? ` and ${surname(second)}` : " et al."
  } (${year})`
}

const Studies = Schema.NonEmptyArray(Study)

// How settled a finding is:
// - Agreed: two or more studies support it, and none in the catalogue
//   disputes it.
// - Single: one study, not yet replicated.
// - Disputed: studies on both sides. `objection` says, in our words, what
//   the disputing studies found instead.
export const Evidence = Schema.TaggedUnion({
  Agreed: { studies: Studies.check(Schema.isMinLength(2)) },
  Single: { study: Study },
  Disputed: { supporting: Studies, disputing: Studies, objection: Schema.NonEmptyString },
})

export type Evidence = typeof Evidence.Type

// The studies behind a finding, on either side.
export const studiesOf = (evidence: Evidence): ReadonlyArray<Study> =>
  Evidence.match(evidence, {
    Agreed: ({ studies }) => studies,
    Single: ({ study }) => [study],
    Disputed: ({ supporting, disputing }) => [...supporting, ...disputing],
  })

// One research result, in our own words, with the studies behind it: the
// only place a cause of a figure's change comes from. Its name reads inside
// a sentence ("larger fiscal multipliers during the euro crisis"); its claim
// is one or two of our sentences, never a paper's. It covers the indicators
// it explains, of every source, in some countries over some years.
export const Finding = Schema.Struct({
  id: Slug,
  name: Schema.NonEmptyString,
  claim: Schema.NonEmptyString,
  indicators: Schema.NonEmptyArray(IndicatorId).check(Schema.isUnique()),
  scope: Scope,
  from: Year,
  to: Year,
  evidence: Evidence,
}).check(
  Schema.makeFilter(({ from, to }) => from <= to || "from must not be after to"),
  Schema.makeFilter(({ evidence }) => {
    const urls = studiesOf(evidence).map((study) => study.url)

    return new Set(urls).size === urls.length || "each study appears once"
  }),
)

export interface Finding extends Schema.Schema.Type<typeof Finding> {}
