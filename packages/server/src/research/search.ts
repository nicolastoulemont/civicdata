import { countries, Country } from "@repo/domain"
import { Schema } from "effect"
import { stemmer } from "stemmer"

import { Scope, keyOf } from "./annotation.ts"
import type { Entry } from "./entry.ts"

const Period = Schema.Struct({
  from: Scope.fields.periods.value.fields.from,
  to: Scope.fields.periods.value.fields.to,
}).check(Schema.makeFilter(({ from, to }) => from <= to || "from must not be after to"))

export const Question = Schema.Struct({
  text: Schema.NonEmptyString,
  countries: Schema.Array(Country),
  period: Schema.NullOr(Period),
  intent: Schema.Literals(["Evidence", "Cause"]),
})

export interface Question extends Schema.Schema.Type<typeof Question> {}

// These are retrieval terms, not a semantic or causal support check.
const stop = new Set(
  "a an and are as at be by can did do does for from how in is it of on or that the their there this to was were what when which who why with study paper evidence find report show result effect impact cause causal estimate relationship association between own".split(
    " ",
  ),
)

const termsOf = (text: string) =>
  new Set(
    (text.toLowerCase().match(/[a-z]{3,}/g) ?? []).flatMap((word) => {
      if (stop.has(word)) return []

      return [stemmer(word)]
    }),
  )

// Explicit filters are preferable for aliases and complex periods. CLI inference
// recognises canonical country names and literal four-digit years only.
export const questionOf = (text: string): Question => {
  const years = [...text.matchAll(/\b(?:18|19|20)\d{2}\b/g)].map(([year]) => Number(year))
  const lower = ` ${text.toLowerCase().replace(/[^a-z]/g, " ")} `

  return Question.make({
    text,
    countries: countries.flatMap(({ code, name }) =>
      lower.includes(` ${name.toLowerCase().replace(/[^a-z]/g, " ")} `) ? [code] : [],
    ),
    period: years.length === 0 ? null : { from: Math.min(...years), to: Math.max(...years) },
    intent: /\b(?:why|caus\w*|effects?|impacts?|caused)\b/i.test(text) ? "Cause" : "Evidence",
  })
}

interface Options {
  readonly question: Question
  readonly confidence?: number
}

export const search = (entries: ReadonlyArray<Entry>, options: Options) => {
  const { question } = options
  const confidence = options.confidence ?? 0.9

  const geography = new Set(
    countries.flatMap(({ code, name }) =>
      question.countries.includes(code) ? Array.from(termsOf(name)) : [],
    ),
  )

  const wanted = new Set([...termsOf(question.text)].filter((term) => !geography.has(term)))
  const year = question.period

  const scoped = entries.filter(
    ({ annotation }) =>
      question.countries.every((code) =>
        annotation.scope.countries.some((country) => country.code === code),
      ) &&
      (year === null ||
        annotation.scope.periods.some(({ from, to }) => from <= year.from && to >= year.to)),
  )

  const eligible = scoped.filter(
    ({ annotation }) =>
      question.intent === "Evidence" ||
      Scope.fields.design.guards.AuthorCausalEstimate(annotation.scope.design),
  )

  const population = entries.flatMap(({ paper }) =>
    paper.content.passages.map(({ text }) => termsOf(text)),
  )

  const weight = new Map(
    [...wanted].map((term) => [
      term,
      Math.log(
        1 + population.length / (1 + population.filter((tokens) => tokens.has(term)).length),
      ),
    ]),
  )

  const ranked = eligible
    .flatMap(({ paper, annotation }) => {
      const labels = new Map(annotation.labels.map((label) => [keyOf(label), label]))

      const accepted = annotation.excerpts.filter((result) => result.confidence >= confidence)

      const joined = accepted.flatMap((left) =>
        accepted.flatMap((right) => {
          if (left.page !== right.page || left.category !== right.category) return []
          const quote = `${left.quote} ${right.quote}`

          const source = paper.content.passages
            .flatMap((passage) => (passage.page === left.page ? [passage.text] : []))
            .join(" ")

          return source.includes(quote)
            ? [
                {
                  page: left.page,
                  part: null,
                  text: quote,
                  category: left.category,
                  confidence: Math.min(left.confidence, right.confidence),
                },
              ]
            : []
        }),
      )

      const candidates = [
        ...joined,
        ...paper.content.passages.flatMap((passage) => {
          const label = labels.get(keyOf(passage))

          return label === undefined
            ? []
            : [{ ...passage, category: label.category, confidence: label.confidence }]
        }),
        ...annotation.excerpts.map(({ page, quote, category, confidence: score }) => ({
          page,
          part: null,
          text: quote,
          category,
          confidence: score,
        })),
      ]

      return candidates.flatMap(({ category, confidence: certainty, ...passage }) => {
        if (
          // Missing-glyph controls and private-use digits cannot be quoted as readable evidence.
          // oxlint-disable-next-line no-control-regex -- Detect PDF extraction corruption.
          /[\p{Co}\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(passage.text) ||
          certainty < confidence ||
          !["Description", "Association", "AuthorCausalEstimate"].includes(category) ||
          (question.intent === "Cause" && category !== "AuthorCausalEstimate")
        )
          return []
        const tokens = termsOf(passage.text)
        const title = termsOf(paper.seed.study.title)
        const covered = [...wanted].every((term) => tokens.has(term) || title.has(term))
        const hits = [...wanted].filter((term) => tokens.has(term))

        if (wanted.size < 2 || hits.length < 2 || !covered) return []

        const score =
          hits.reduce((sum, term) => sum + (weight.get(term) ?? 0), 0) / Math.sqrt(tokens.size)

        const contexts = [
          ...annotation.excerpts.flatMap(({ page, quote, category: role, confidence: rating }) =>
            rating >= confidence && ["Method", "Limitation"].includes(role)
              ? [{ page, part: null, text: quote, category: role }]
              : [],
          ),
          ...paper.content.passages.flatMap((other) => {
            const tag = labels.get(keyOf(other))

            return tag !== undefined &&
              tag.confidence >= confidence &&
              ["Method", "Limitation"].includes(tag.category)
              ? [{ ...other, category: tag.category }]
              : []
          }),
        ]

        const context = ["Method", "Limitation"].flatMap((role) =>
          contexts
            .filter((item) => item.category === role)
            .toSorted((a, b) => Math.abs(a.page - passage.page) - Math.abs(b.page - passage.page))
            .slice(0, 1),
        )

        return [
          {
            score,
            category,
            confidence: certainty,
            passage,
            context,
            scope: annotation.scope,
            citation: {
              study: paper.seed.study,
              paper: paper.seed.id,
              content: paper.content.id,
              copy: paper.content.copy.id,
              providerVersion: paper.content.copy.version,
              sha256: paper.content.sha256,
              snapshot: `${paper.seed.id}-${paper.content.sha256}.pdf`,
              page: passage.page,
              part: passage.part,
              url: `${paper.content.url}#page=${passage.page}`,
              licences: paper.content.evidence,
            },
          },
        ]
      })
    })
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        a.citation.paper.localeCompare(b.citation.paper) ||
        a.passage.page - b.passage.page ||
        (a.passage.part ?? -1) - (b.passage.part ?? -1),
    )

  const seen = new Set<string>()

  const matches = ranked
    .filter(({ citation }) => {
      if (seen.has(citation.paper)) return false
      seen.add(citation.paper)

      return true
    })
    .slice(0, 3)

  return matches.length > 0
    ? { status: "Passages" as const, question, matches }
    : {
        status: "NoEvidence" as const,
        question,
        reason:
          scoped.length === 0
            ? "scope-not-covered"
            : eligible.length === 0
              ? "causal-design-not-covered"
              : "no-matching-trusted-result",
        searched: entries.length,
      }
}
