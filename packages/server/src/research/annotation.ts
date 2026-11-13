import { Country } from "@repo/domain"
import { Schema } from "effect"

import { Paper, Passage } from "./archive.ts"

export const rubric = "research-3"
export const model = "gpt-6-luna"

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

export const keyOf = ({ page, part }: Pick<typeof Passage.Type, "page" | "part">) =>
  `${page}:${part}`

const normalize = (text: string) => text.replace(/\s+/g, " ").trim()

const evidenceOf = (design: Scope["design"]) =>
  Scope.fields.design.match(design, {
    Unknown: () => [],
    Description: ({ evidence }) => [evidence],
    Association: ({ evidence }) => [evidence],
    AuthorCausalEstimate: ({ evidence }) => [evidence],
  })

// A quote proves the model read an existing page, not that its interpretation is true.
export const grounded = (scope: Scope, passages: ReadonlyArray<typeof Passage.Type>) => {
  const anchors = [
    ...scope.excerpts,
    ...(scope.population === null ? [] : [scope.population]),
    ...scope.countries.map(({ evidence }) => evidence),
    ...scope.regions.map(({ evidence }) => evidence),
    ...scope.periods.map(({ evidence }) => evidence),
    ...evidenceOf(scope.design),
  ]

  return (
    anchors.every(
      ({ page, quote }) =>
        normalize(quote).length > 0 &&
        normalize(
          passages.flatMap((passage) => (passage.page === page ? [passage.text] : [])).join(" "),
        ).includes(normalize(quote)),
    ) &&
    scope.periods.every(
      ({ from, to, evidence }) =>
        from <= to && evidence.quote.includes(String(from)) && evidence.quote.includes(String(to)),
    )
  )
}

export const complete = (
  labels: typeof Labels.Type,
  passages: ReadonlyArray<typeof Passage.Type>,
) => {
  const expected = new Set(passages.map(keyOf))

  return (
    labels.length === expected.size &&
    new Set(labels.map(keyOf)).size === expected.size &&
    labels.every((label) => expected.has(keyOf(label)))
  )
}

export const excerptsComplete = (classified: typeof Classification.Type, scope: Scope) =>
  classified.excerpts.length === scope.excerpts.length &&
  classified.excerpts.every((result, index) => {
    const anchor = scope.excerpts[index]

    return anchor !== undefined && anchor.page === result.page && anchor.quote === result.quote
  })
