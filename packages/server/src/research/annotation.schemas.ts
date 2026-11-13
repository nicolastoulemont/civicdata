import { Country } from "@repo/domain"
import { Schema } from "effect"

import { Paper, Passage } from "./archive.schemas.ts"
import { model } from "./constants/model.ts"
import { rubric } from "./constants/rubric.ts"

const Anchor = Schema.Struct({ page: Passage.fields.page, quote: Schema.NonEmptyString })
const Year = Schema.Int.check(Schema.isBetween({ minimum: 1800, maximum: 2100 }))

export const Scope = Schema.Struct({
  population: Schema.NullOr(Anchor),
  excerpts: Schema.Array(Anchor).check(Schema.isMaxLength(16)),
  countries: Schema.Array(Schema.Struct({ code: Country, evidence: Anchor })),
  regions: Schema.Array(Schema.Struct({ name: Schema.NonEmptyString, evidence: Anchor })),
  periods: Schema.Array(Schema.Struct({ from: Year, to: Year, evidence: Anchor })),
  design: Schema.TaggedUnion({
    Unknown: {},
    Description: { evidence: Anchor },
    Association: { evidence: Anchor },
    AuthorCausalEstimate: { evidence: Anchor },
  }),
})

export interface Scope extends Schema.Schema.Type<typeof Scope> {}

export const Category = Schema.Literals([
  "Description",
  "Association",
  "AuthorCausalEstimate",
  "Method",
  "Limitation",
  "Reference",
  "Background",
  "Other",
])

export type Category = typeof Category.Type

const Label = Schema.Struct({
  page: Passage.fields.page,
  part: Passage.fields.part,
  category: Category,
  confidence: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
})

export const Labels = Schema.Array(Label)

const Result = Anchor.mapFields((fields) => ({
  ...fields,
  category: Category,
  confidence: Label.fields.confidence,
}))

export const Classification = Schema.Struct({ labels: Labels, excerpts: Schema.Array(Result) })

export const Stamp = Schema.Struct({
  rubric: Schema.Literal(rubric),
  model: Schema.Literal(model),
  input: Paper.fields.seed.fields.id,
  createdAt: Schema.String,
})

export const Annotation = Schema.Struct({
  stamp: Stamp,
  scope: Scope,
  labels: Labels,
  excerpts: Schema.Array(Result),
})

export class ResearchUnavailable extends Schema.TaggedError<
  ResearchUnavailable,
  { readonly brand: unique symbol }
>()("ResearchUnavailable", { operation: Schema.String, cause: Schema.Unknown }) {}
