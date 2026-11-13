import { Array as Arr, Effect, Option } from "effect"
import { extractText, getDocumentProxy } from "unpdf"

import { fingerprint } from "../fingerprint.ts"
import { Content, type Copy, Evidence, PaperUnavailable, Passage } from "./archive.ts"
import { licenceOf } from "./Licences.ts"
import type { Download } from "./OpenAlex.ts"

// What produced a version's passages: the PDF parser and how passages are
// cut. Change it whenever either changes, so the store keeps the old text
// apart from the new and an annotation never describes text it did not read.
export const extraction = "unpdf-2.1.0/300-words"

// Passages never cross a physical PDF page. The page is its one-based PDF
// position, not the printed journal page number. No claim is extracted here.
const passagesOf = (pages: ReadonlyArray<string>) =>
  pages.flatMap((text, index) => {
    const words = text.trim().split(/\s+/).filter(Boolean)
    const passages: Array<typeof Passage.Type> = []

    for (let start = 0; start < words.length; start += 300) {
      passages.push(
        Passage.make({
          page: index + 1,
          part: passages.length,
          text: words.slice(start, start + 300).join(" "),
        }),
      )
    }

    return passages
  })

const readPdf = (bytes: Uint8Array) =>
  Effect.tryPromise({
    try: async () => {
      const pdf = await getDocumentProxy(bytes, { maxImageSize: 0, verbosity: 0 })

      try {
        if (pdf.numPages > 200) throw new Error("PDF exceeds 200 pages")
        const { text } = await extractText(pdf, { mergePages: false })

        return text
      } finally {
        await pdf.loadingTask.destroy()
      }
    },
    catch: (cause) => new PaperUnavailable({ operation: "extract", cause }),
  })

export const textOf = Effect.fn("Papers.text")(function* (
  download: Omit<Download, "landing">,
  options: { readonly copy: Copy; readonly evidence: ReadonlyArray<Evidence> },
) {
  const { bytes, url, retrievedAt } = download
  const { copy } = options
  const sha256 = yield* fingerprint(bytes)
  const pages = yield* readPdf(new Uint8Array(bytes))
  const cover = pages.slice(0, 2)

  if (cover.some((page) => /all\s+rights\s+reserved/i.test(page))) {
    return Content.cases.Metadata.make({ reason: "licence-conflict" })
  }

  const notices = cover.flatMap((text, index) =>
    [
      ...text
        .replace(/(https?:\/\/)\s+(?=creativecommons\.org)/gi, "$1")
        .matchAll(/https?:\/\/creativecommons\.org\/(?:licenses|publicdomain)\/[^\s<>)]+/gi),
    ].map(([value]) => ({ value: value.replace(/[.,;]+$/, ""), page: index + 1 })),
  )

  if (notices.some(({ value }) => Option.isNone(licenceOf(value)))) {
    return Content.cases.Metadata.make({ reason: "licence-conflict" })
  }

  const evidence = [
    ...options.evidence,
    ...notices.flatMap(({ value, page }) =>
      Option.toArray(
        Option.map(licenceOf(value), (licence) =>
          Evidence.cases.Pdf.make({
            url,
            sha256,
            page,
            licence,
            retrievedAt,
          }),
        ),
      ),
    ),
  ]

  if (!Arr.isArrayNonEmpty(evidence))
    return Content.cases.Metadata.make({ reason: "licence-unconfirmed" })

  if (new Set(evidence.map(({ licence }) => licence)).size > 1) {
    return Content.cases.Metadata.make({ reason: "licence-conflict" })
  }

  const passages = passagesOf(pages)

  if (!Arr.isArrayNonEmpty(passages)) {
    return yield* new PaperUnavailable({
      operation: "extract",
      cause: "PDF has no extractable text",
    })
  }

  return yield* Content.cases.Text.makeEffect({
    copy,
    url,
    evidence,
    id: yield* fingerprint(`${copy.id}|${copy.version}|${sha256}`),
    sha256,
    pages: pages.length,
    emptyPages: pages.flatMap((text, index) => (text.trim() === "" ? [index + 1] : [])),
    passages,
  }).pipe(Effect.mapError((cause) => new PaperUnavailable({ operation: "extract", cause })))
})
