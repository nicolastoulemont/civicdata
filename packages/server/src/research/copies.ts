import { Effect } from "effect"

import { Attempt, Content, type Copy, type Work } from "./archive.schemas.ts"
import { admitted } from "./constants/admitted.ts"
import { PageCheck } from "./Licences.schemas.ts"
import { Licences } from "./Licences.ts"
import { OpenAlex } from "./OpenAlex.ts"
import { textOf } from "./pdf.ts"
import { copiesOf } from "./utils/copiesOf.ts"
import { qualifies } from "./utils/qualifies.ts"

// How likely a copy is to serve its PDF to a script, most likely first: a
// labelled repository copy, which OpenAlex harvested over OAI-PMH (PubMed
// Central, Europe PMC, arXiv, EconStor and other repositories), then a
// labelled published version, then the rest in OpenAlex's order.
// Publishers refuse scripts more often than repositories do.
const rank = (copy: Copy) => {
  if (!admitted.has(copy.license ?? "")) return 2

  if (copy.id.startsWith("pmh:")) return 0

  return copy.version === "publishedVersion" ? 1 : 2
}

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

  // An item page vouches for the PDF it names, not for one a landing page
  // led to.
  const content = yield* textOf(download, {
    copy,
    evidence: download.landing === null ? evidence : [],
  })

  return { content, pdf: Content.guards.Text(content) ? download.bytes : null }
})

const excluded = (reason: typeof Content.cases.Metadata.Type.reason) => {
  if (reason === "licence-conflict" || reason === "licence-unconfirmed") return reason

  return "licence-not-admitted"
}

// Tries at most three of a work's identified copies, those worth
// downloading first, most likely to serve their PDF first, and keeps the
// first whose text is admitted. A copy that fails moves the work on to the
// next. Every other copy tried leaves a receipt: excluded, or failed when
// its host or its PDF failed.
export const admit = Effect.fn("Papers.admit")(function* (work: Work) {
  const attempts: Array<Attempt> = []
  const listed = copiesOf(work)

  const candidates = [
    ...listed.filter(qualifies).toSorted((a, b) => rank(a) - rank(b)),
    ...listed.filter((copy) => !qualifies(copy)),
  ].slice(0, 3)

  for (const copy of candidates) {
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

    if (result.content !== null && Content.guards.Text(result.content) && result.pdf !== null) {
      return { content: result.content, pdf: result.pdf, attempts }
    }

    const outcome =
      result.failure ??
      Attempt.fields.result.cases.Excluded.make({
        reason: excluded(
          result.content !== null && Content.guards.Metadata(result.content)
            ? result.content.reason
            : "no-licensed-pdf",
        ),
      })

    attempts.push(Attempt.make({ copy, result: outcome }))
  }

  return { attempts, pdf: null, content: Content.cases.Metadata.make({ reason: "no-usable-copy" }) }
})
