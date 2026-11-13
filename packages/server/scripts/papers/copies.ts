import { Effect } from "effect"

import { Attempt, Content, type Copy, type Paper } from "../../src/research/archive.ts"
import { Licences, PageCheck, supported } from "./licences.ts"
import { copiesOf, OpenAlex } from "./openalex.ts"
import { textOf } from "./pdf.ts"

const admitted = new Set(["cc-by", "cc0", "public-domain"])

const tryCopy = Effect.fn("Papers.copy")(function* (copy: Copy) {
  const rights = yield* Licences
  const source = yield* OpenAlex
  const checked = yield* rights.forCopy(copy)

  if (PageCheck.guards.Denied(checked))
    return { content: Content.cases.Metadata.make({ reason: "licence-conflict" }), pdf: null }

  const evidence = PageCheck.match(checked, {
    Unknown: () => [],
    Denied: () => [],
    Allowed: (allowed) => [allowed.evidence],
  })

  if (evidence.length === 0 && !admitted.has(copy.license ?? "")) {
    return { content: Content.cases.Metadata.make({ reason: "no-licensed-pdf" }), pdf: null }
  }

  const download = yield* source.download(copy)
  const content = yield* textOf(download, { copy, evidence })

  return { content, pdf: Content.guards.Text(content) ? download.bytes : null }
})

const excluded = (reason: typeof Content.cases.Metadata.Type.reason) => {
  if (reason === "licence-conflict" || reason === "licence-unconfirmed") return reason

  return "licence-not-admitted"
}

// Try at most three identified copies. Keep unsuccessful receipts so a
// failed mirror retries without downloading already excluded copies again.
export const gatherCopies = Effect.fn("Papers.copies")(function* (
  work: NonNullable<Paper["work"]>,
  options: { previous: Paper | null; refresh: boolean },
) {
  const attempts: Array<Attempt> = []

  const listed = copiesOf(work)
  const eligible = listed.filter((copy) => admitted.has(copy.license ?? "") || supported(copy))
  const eligibleSet = new Set(eligible)
  const candidates = [...eligible, ...listed.filter((copy) => !eligibleSet.has(copy))].slice(0, 3)

  for (const copy of candidates) {
    const cached = options.refresh
      ? undefined
      : options.previous?.attempts.find(
          (attempt) =>
            Attempt.fields.result.guards.Excluded(attempt.result) &&
            JSON.stringify(attempt.copy) === JSON.stringify(copy),
        )

    if (cached !== undefined) {
      attempts.push(cached)
      continue
    }

    const result = yield* tryCopy(copy).pipe(
      Effect.map(({ content, pdf }) => ({ content, pdf, failure: null })),
      Effect.catchTag("PaperUnavailable", (error) =>
        Effect.succeed({
          content: null,
          pdf: null,
          failure: Attempt.fields.result.cases.Failed.make({
            operation: error.operation,
            problem: String(error.cause),
          }),
        }),
      ),
    )

    if (result.content !== null && Content.guards.Text(result.content)) {
      return { content: result.content, pdf: result.pdf, attempts }
    }

    const outcome =
      result.failure ??
      Attempt.fields.result.cases.Excluded.make({
        reason: excluded(result.content?.reason ?? "no-licensed-pdf"),
      })

    attempts.push(Attempt.make({ copy, result: outcome }))
  }

  return { attempts, pdf: null, content: Content.cases.Metadata.make({ reason: "no-usable-copy" }) }
})
