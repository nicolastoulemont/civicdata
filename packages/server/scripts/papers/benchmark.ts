import { Schema } from "effect"

import { Category } from "../../src/research/annotation.schemas.ts"
import { Paper, Passage } from "../../src/research/archive.schemas.ts"
import { rubric } from "../../src/research/constants/rubric.ts"
import type { Entry } from "../../src/research/entry.schemas.ts"
import { keyOf } from "../../src/research/utils/keyOf.ts"
import { questionOf } from "../../src/research/utils/questionOf.ts"
import { search } from "../../src/research/utils/search.ts"

export const Sample = Schema.Struct({
  rubric: Schema.Literal(rubric),
  note: Schema.String,
  rows: Schema.Array(
    Schema.Struct({
      paper: Paper.fields.seed.fields.id,
      page: Passage.fields.page,
      part: Passage.fields.part,
      category: Category,
      split: Schema.Literals(["Calibration", "Holdout"]),
    }),
  ),
})

export const Questions = Schema.Array(
  Schema.Struct({
    text: Schema.NonEmptyString,
    papers: Schema.Array(Paper.fields.seed.fields.id),
  }),
)

interface Options {
  readonly sample: typeof Sample.Type
  readonly questions: typeof Questions.Type
}

export const benchmark = (entries: ReadonlyArray<Entry>, { sample, questions }: Options) => {
  const classified = sample.rows.map((row) => {
    const label = entries
      .find(({ paper }) => paper.seed.id === row.paper)
      ?.annotation.labels.find((candidate) => keyOf(candidate) === keyOf(row))

    return {
      ...row,
      predicted: label === undefined ? null : label.category,
      confidence: label === undefined ? null : label.confidence,
      correct: label !== undefined && label.category === row.category,
    }
  })

  const answers = questions.map(({ text, papers }) => {
    const answer = search(entries, { question: questionOf(text) })

    const matches =
      answer.status === "Passages"
        ? answer.matches.map(({ citation, category }) => ({
            paper: citation.paper,
            page: citation.page,
            part: citation.part,
            category,
            url: citation.url,
          }))
        : []

    return {
      text,
      expected: papers,
      status: answer.status,
      reason: answer.reason,
      matches,
      correct:
        papers.length === 0
          ? answer.status === "NoEvidence"
          : matches.length > 0 && matches.every((match) => papers.includes(match.paper)),
    }
  })

  return {
    documents: entries.length,
    passages: entries.reduce((sum, { annotation }) => sum + annotation.labels.length, 0),
    classification: ["Calibration", "Holdout"].map((split) => {
      const rows = classified.filter((row) => row.split === split)

      return {
        split,
        count: rows.length,
        correct: rows.filter(({ correct }) => correct).length,
        acceptedAtThreshold: [0.8, 0.9, 0.95].map((threshold) => {
          const accepted = rows.filter(
            ({ confidence }) => confidence !== null && confidence >= threshold,
          )

          return {
            threshold,
            count: accepted.length,
            correct: accepted.filter(({ correct }) => correct).length,
          }
        }),
      }
    }),
    acceptedLabelErrors: classified.filter(
      ({ confidence, correct }) => confidence !== null && confidence >= 0.9 && !correct,
    ).length,
    labels: classified,
    retrieval: {
      total: answers.length,
      correct: answers.filter(({ correct }) => correct).length,
      falsePositives: answers.filter(
        ({ expected, status }) => expected.length === 0 && status === "Passages",
      ).length,
      answers,
    },
  }
}
