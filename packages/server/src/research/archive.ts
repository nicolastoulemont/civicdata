import { Study } from "@repo/domain"
import { Schema } from "effect"

const Https = Schema.String.check(Schema.isPattern(/^https:\/\/[^\s]+$/))

export const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
const Page = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))

export type Mode = "Resume" | "Refresh" | "Offline"

const WorkId = Schema.String.check(Schema.isPattern(/^https:\/\/openalex.org\/W\d+$/))

export const Seed = Schema.Struct({
  openalex: Schema.NullOr(WorkId),
  id: Digest,
  study: Study.mapFields((fields) => ({
    ...fields,
    authors: Schema.Array(Schema.NonEmptyString),
    publisher: Schema.NullOr(Schema.NonEmptyString),
  })),
})

export interface Seed extends Schema.Schema.Type<typeof Seed> {}

const Location = Schema.Struct({
  id: Schema.NullOr(Schema.NonEmptyString),
  doi: Schema.NullOr(Schema.String),
  raw_source_name: Schema.NullOr(Schema.String),
  landing_page_url: Schema.NullOr(Schema.String.check(Schema.isPattern(/^https?:\/\/[^\s]+$/))),
  pdf_url: Schema.NullOr(Schema.String.check(Schema.isPattern(/^https?:\/\/[^\s]+$/))),
  license: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.String),
})

export const Work = Schema.Struct({
  id: WorkId,
  type: Schema.NonEmptyString,
  authorships: Schema.Array(
    Schema.Struct({
      author: Schema.Struct({ display_name: Schema.NullOr(Schema.NonEmptyString) }),
    }),
  ),
  doi: Schema.NullOr(Schema.String),
  title: Schema.NonEmptyString,
  publication_year: Schema.Int,
  updated_date: Schema.NonEmptyString,
  is_retracted: Schema.Boolean,
  locations: Schema.Array(Location),
})

export interface Work extends Schema.Schema.Type<typeof Work> {}

// Start with permissive licences only. Free to read is not permission to
// redistribute. A location's licence applies to that copy, not every copy.
export const Copy = Location.mapFields((fields) => ({
  ...fields,
  pdf_url: Https,
  id: Schema.NonEmptyString,
  version: Schema.Literals(["publishedVersion", "acceptedVersion", "submittedVersion"]),
}))

export interface Copy extends Schema.Schema.Type<typeof Copy> {}

export const Passage = Schema.Struct({
  page: Page,
  part: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  text: Schema.NonEmptyString,
})

export const Licence = Schema.String.check(
  Schema.isPattern(
    /^https:\/\/creativecommons\.org\/(?:licenses\/by\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)|publicdomain\/(?:zero|mark)\/1\.0)\/$/,
  ),
)

export const Evidence = Schema.TaggedUnion({
  Pdf: {
    url: Https,
    sha256: Digest,
    page: Page,
    licence: Licence,
    retrievedAt: Schema.String,
  },
  Page: {
    url: Https,
    sha256: Digest,
    record: Schema.NonEmptyString,
    pdf: Https,
    licence: Licence,
    retrievedAt: Schema.String,
  },
})

export type Evidence = typeof Evidence.Type

export const Attempt = Schema.Struct({
  copy: Copy,
  result: Schema.TaggedUnion({
    Excluded: {
      reason: Schema.Literals(["licence-conflict", "licence-unconfirmed", "licence-not-admitted"]),
    },
    Failed: { operation: Schema.String, problem: Schema.String },
  }),
})

export interface Attempt extends Schema.Schema.Type<typeof Attempt> {}

export const Content = Schema.TaggedUnion({
  Metadata: {
    reason: Schema.Literals([
      "no-doi",
      "not-found",
      "different-doi",
      "retracted",
      "no-licensed-pdf",
      "licence-conflict",
      "licence-unconfirmed",
      "no-usable-copy",
    ]),
  },
  Text: {
    copy: Copy,
    id: Digest,
    url: Https,
    evidence: Schema.NonEmptyArray(Evidence),
    sha256: Digest,
    pages: Page,
    emptyPages: Schema.Array(Page),
    passages: Schema.NonEmptyArray(Passage),
  },
})

export const Paper = Schema.Struct({
  format: Schema.Literal(3),
  attempts: Schema.Array(Attempt),
  seed: Seed,
  metadataUrl: Schema.NullOr(Https),
  retrievedAt: Schema.String,
  work: Schema.NullOr(Work),
  content: Content,
})

export interface Paper extends Schema.Schema.Type<typeof Paper> {}

export class PaperUnavailable extends Schema.TaggedError<
  PaperUnavailable,
  { readonly brand: unique symbol }
>()("PaperUnavailable", {
  operation: Schema.String,
  cause: Schema.Unknown,
}) {}
