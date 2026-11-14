import { Array as Arr, Effect, Option, Schema } from "effect"
import { extractText, getDocumentProxy } from "unpdf"

import { fingerprint } from "../utils/fingerprint.ts"
import { Content, type Copy, Evidence, PaperUnavailable, Passage } from "./archive.schemas.ts"
import type { Download } from "./OpenAlex.types.ts"
import { licenceOf } from "./utils/licenceOf.ts"

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

// A link a page puts on its text, as pdf.js reads its annotations.
const Link = Schema.Struct({ subtype: Schema.Literal("Link"), url: Schema.String })

const isCreativeCommons = (url: string) =>
  /^https?:\/\/creativecommons\.org\/(?:licenses|publicdomain)\//i.test(url)

// A PDF's text, page by page, and the Creative Commons URLs its first two
// pages link from their text, as MDPI links its notice "Creative Commons
// Attribution (CC BY) license" without printing the URL.
const readPdf = (bytes: Uint8Array) =>
  Effect.tryPromise({
    try: async () => {
      const pdf = await getDocumentProxy(bytes, { maxImageSize: 0, verbosity: 0 })

      try {
        if (pdf.numPages > 200) throw new Error("PDF exceeds 200 pages")
        const { text } = await extractText(pdf, { mergePages: false })

        const links = await Promise.all(
          text.slice(0, 2).map(async (_, index) => {
            const page = await pdf.getPage(index + 1)
            const annotations: ReadonlyArray<unknown> = await page.getAnnotations()

            return annotations.flatMap((annotation) =>
              Option.toArray(Schema.decodeUnknownOption(Link)(annotation)).flatMap(({ url }) =>
                isCreativeCommons(url) ? [url] : [],
              ),
            )
          }),
        )

        return { text, links }
      } finally {
        await pdf.loadingTask.destroy()
      }
    },
    catch: (cause) => new PaperUnavailable({ operation: "extract", cause }),
  })

// A page's text with the licence URLs its layout broke over lines joined
// again: after the scheme, and before the version, as MDPI's footer prints
// "(https://\ncreativecommons.org/licenses/by/\n4.0/)". A URL broken
// anywhere else stays broken, and reads as a licence the gather does not
// know.
const joined = (text: string) =>
  text
    .replace(/(https?:\/\/)\s+(?=creativecommons\.org)/gi, "$1")
    .replace(/(creativecommons\.org\/(?:licenses|publicdomain)\/[a-z-]+\/)\s+(?=\d\.\d)/gi, "$1")

// The waiver's sentence, with whatever its parentheses hold.
const waiver = /Public\s+Domain\s+Dedication\s+waiver\s*\(([^)]*)\)\s*applies\s+to\s+the\s+data/gi

const cc0 = "https://creativecommons.org/publicdomain/zero/1.0/"

// A page's text without the waiver BMC and SpringerOpen print for an
// article's data: "The Creative Commons Public Domain Dedication waiver
// (http://creativecommons.org/publicdomain/zero/1.0/) applies to the data
// made available in this article". Its CC0 URL licenses the data, not the
// text, so it is no second licence, even where the layout broke the URL
// over lines. A CC0 URL anywhere else still counts.
const unwaived = (text: string) =>
  text.replaceAll(waiver, (sentence, url: string) =>
    /^https?:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/?$/i.test(url.replace(/\s+/g, ""))
      ? ""
      : sentence,
  )

export const textOf = Effect.fn("Papers.text")(function* (
  download: Omit<Download, "landing">,
  options: { readonly copy: Copy; readonly evidence: ReadonlyArray<Evidence> },
) {
  const { bytes, url, retrievedAt } = download
  const { copy } = options
  const sha256 = yield* fingerprint(bytes)
  const { text: pages, links } = yield* readPdf(new Uint8Array(bytes))
  const cover = pages.slice(0, 2)

  if (cover.some((page) => /all\s+rights\s+reserved/i.test(page))) {
    return Content.cases.Metadata.make({ reason: "licence-conflict" })
  }

  const printed = cover.flatMap((text, index) =>
    [
      ...unwaived(joined(text)).matchAll(
        /https?:\/\/creativecommons\.org\/(?:licenses|publicdomain)\/[^\s<>)]+/gi,
      ),
    ].map(([value]) => ({ value: value.replace(/[.,;]+$/, ""), page: index + 1 })),
  )

  // A link is a notice too, unless its page prints the same licence, or
  // it is CC0 on a page that prints the waiver for the article's data,
  // whose URL the waiver links.
  const linked = links.flatMap((urls, index) => {
    const page = index + 1
    const text = joined(cover[index] ?? "")
    const waived = unwaived(text) !== text

    const same = (link: string) =>
      printed.some(
        (notice) =>
          notice.page === page &&
          Option.getOrUndefined(licenceOf(notice.value)) === Option.getOrUndefined(licenceOf(link)),
      )

    return [...new Set(urls)].flatMap((link) =>
      same(link) || (waived && Option.getOrUndefined(licenceOf(link)) === cc0)
        ? []
        : [{ value: link, page }],
    )
  })

  const notices = [...printed, ...linked]

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
