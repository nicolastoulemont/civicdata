import { Clock, Context, Effect, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { getDomain } from "tldts"

import { Copy, Https, PaperUnavailable, type Seed, Work } from "./archive.ts"
import { metaOf } from "./utils/html.ts"
import { bodyOf, briefOf } from "./utils/http.ts"
import {
  type Article,
  articleOf,
  bucket,
  Deposit,
  depositsOf,
  listingOf,
  metadataOf,
  pdfOf,
  pdfUrlOf,
  pmcidOf,
} from "./pmc.ts"

export interface Download {
  readonly bytes: Uint8Array
  readonly url: string
  // The page that named the PDF in its `citation_pdf_url` tag, when the
  // copy's PDF URL answered that page instead of a PDF.
  readonly landing: string | null
  readonly retrievedAt: string
}

// One page of a search: the works that decode, how many did not, and the
// cursor of the next page, or null after the last.
interface Page {
  readonly works: ReadonlyArray<Work>
  readonly skipped: number
  readonly next: string | null
}

// What a search asks OpenAlex: its words, whether it keeps to EconStor's
// repository copies, and the day from which works must have been created or
// updated, if any.
interface Query {
  readonly query: string
  readonly repository?: boolean | undefined
  readonly since?: string | null | undefined
}

interface Interface {
  readonly lookup: (seed: {
    readonly openalex: Seed["openalex"]
    readonly study: Pick<Seed["study"], "doi">
  }) => Effect.Effect<Work | null, PaperUnavailable>
  // One page of a search, from `cursor` ("*" for the first).
  readonly page: (
    query: Query,
    options: { readonly cursor: string; readonly size: number },
  ) => Effect.Effect<Page, PaperUnavailable>
  // The current records of these works, at most 100. A work OpenAlex no
  // longer lists, such as one merged into another, is missing from the map.
  readonly works: (
    ids: ReadonlyArray<Work["id"]>,
  ) => Effect.Effect<ReadonlyMap<Work["id"], Work>, PaperUnavailable>
  readonly download: (copy: Copy) => Effect.Effect<Download, PaperUnavailable>
}

export const metadataUrl = (identity: string) =>
  `https://api.openalex.org/works/${encodeURIComponent(identity.startsWith("https://openalex.org/") ? identity : `https://doi.org/${identity}`)}`

// The fields `Work` reads, so a page of 200 works stays small.
const select = "id,type,authorships,doi,title,publication_year,updated_date,is_retracted,locations"

// Open access, not retracted, in English, published from 1990, or from
// `since` when the query gives a day; EconStor's repository (S4306401696)
// when the query keeps to it. OpenAlex refuses `from_updated_date` and
// `from_created_date` without a paid plan, so a weekly run narrows its
// search by publication date.
const filterOf = ({ repository, since }: Query) =>
  `is_oa:true,is_retracted:false,language:en,from_publication_date:${since ?? "1990-01-01"}` +
  (repository === true ? ",locations.source.id:S4306401696" : "")

const searchUrl = (query: Query, { cursor, size }: { cursor: string; size: number }) => {
  const url = new URL("https://api.openalex.org/works")
  url.searchParams.set("search", query.query)
  url.searchParams.set("filter", filterOf(query))
  url.searchParams.set("per-page", String(size))
  url.searchParams.set("cursor", cursor)
  url.searchParams.set("select", select)

  return url.href
}

const worksUrl = (ids: ReadonlyArray<Work["id"]>) => {
  const url = new URL("https://api.openalex.org/works")
  url.searchParams.set(
    "filter",
    `ids.openalex:${ids.map((id) => id.replace("https://openalex.org/", "")).join("|")}`,
  )
  url.searchParams.set("per-page", String(ids.length))
  url.searchParams.set("select", select)

  return url.href
}

const Results = Schema.Struct({
  meta: Schema.Struct({ next_cursor: Schema.optional(Schema.NullOr(Schema.String)) }),
  results: Schema.Array(Schema.Unknown),
})

// A record that does not decode, such as a work without a title, is
// skipped rather than failing the page.
const decoded = (results: ReadonlyArray<unknown>) => {
  const works = results.flatMap((result) =>
    Option.toArray(Schema.decodeUnknownOption(Work)(result)),
  )

  return { works, skipped: results.length - works.length }
}

// OpenAlex lists many PubMed Central copies without a PDF URL; the gather
// finds their PDF by PMC id, so such a copy gets PMC's address for it.
const located = (location: Work["locations"][number]) => {
  const pmcid = location.id === null || location.pdf_url !== null ? undefined : pmcidOf(location.id)

  return pmcid === undefined ? location : { ...location, pdf_url: pdfOf(pmcid) }
}

export const copiesOf = (work: Work) => {
  const copies = work.locations.flatMap((location) =>
    Option.toArray(Schema.decodeUnknownOption(Copy)(located(location))),
  )

  // A copy's native id, URL and version stay separate from the catalogue's
  // work/DOI grouping. Duplicate listing rows do not cause duplicate downloads.
  return [
    ...new Map(copies.map((copy) => [`${copy.id}|${copy.version}|${copy.pdf_url}`, copy])).values(),
  ]
}

// A Highwire Press tag naming a page's PDF, as Google Scholar and Zotero
// read it.
const PdfTag = Schema.Struct({ name: Schema.Literal("citation_pdf_url"), content: Https })

// A URL's registrable domain. Private suffixes such as github.io count as
// suffixes, so two sites under one stay apart.
const domainOf = (url: string) => getDomain(url, { allowPrivateDomains: true })

// The PDF a landing page names, if it sits on the page's registrable domain
// or the copy's landing page's. A link to another site, or back to the page
// itself, is not followed.
const linkOf = (html: string, { page, copy }: { readonly page: string; readonly copy: Copy }) => {
  const sites = new Set(
    [page, copy.landing_page_url].flatMap((url) => {
      const domain = url === null ? null : domainOf(url)

      return domain === null ? [] : [domain]
    }),
  )

  return metaOf(html)
    .flatMap((tag) => Option.toArray(Schema.decodeUnknownOption(PdfTag)(tag)))
    .map(({ content }) => content)
    .find((link) => link !== page && link !== copy.pdf_url && sites.has(domainOf(link) ?? ""))
}

// The host the gather asks for a copy's PDF: PMC's bucket for a PubMed
// Central copy, the PDF URL's host for any other.
export const hostOf = (copy: Copy) =>
  articleOf(copy) === undefined ? new URL(copy.pdf_url).host : bucket

const now = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis).toISOString())

const isPdf = (bytes: Uint8Array) =>
  new TextDecoder().decode(bytes.subarray(0, 5)).startsWith("%PDF-")

export class OpenAlex extends Context.Service<OpenAlex, Interface>()("papers/OpenAlex") {
  static readonly layer = Layer.effect(
    OpenAlex,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const client = http.pipe(HttpClient.filterStatusOk)

      const lookup = Effect.fn("OpenAlex.lookup")(
        function* (seed: {
          readonly openalex: Seed["openalex"]
          readonly study: Pick<Seed["study"], "doi">
        }) {
          const identity = seed.openalex ?? seed.study.doi

          if (identity === null) return null
          const response = yield* http.get(metadataUrl(identity))

          if (response.status === 404) return null
          yield* HttpClientResponse.filterStatusOk(response)

          return yield* HttpClientResponse.schemaBodyJson(Work)(response)
        },
        Effect.timeout("30 seconds"),
        Effect.mapError((cause) => new PaperUnavailable({ operation: "metadata", cause })),
      )

      const page = Effect.fn("OpenAlex.page")(
        function* (query: Query, options: { readonly cursor: string; readonly size: number }) {
          const response = yield* client.get(searchUrl(query, options))
          const { meta, results } = yield* HttpClientResponse.schemaBodyJson(Results)(response)

          // OpenAlex sends a cursor with the last page too; an empty page ends.
          const next = results.length === 0 ? null : (meta.next_cursor ?? null)

          return { ...decoded(results), next }
        },
        Effect.timeout("30 seconds"),
        Effect.mapError((cause) => new PaperUnavailable({ operation: "discovery", cause })),
      )

      const works = Effect.fn("OpenAlex.works")(
        function* (ids: ReadonlyArray<Work["id"]>) {
          if (ids.length === 0) return new Map<Work["id"], Work>()
          const response = yield* client.get(worksUrl(ids))
          const { results } = yield* HttpClientResponse.schemaBodyJson(Results)(response)
          const wanted = new Set(ids)

          return new Map(
            decoded(results)
              .works.filter((work) => wanted.has(work.id))
              .map((work) => [work.id, work]),
          )
        },
        Effect.timeout("30 seconds"),
        Effect.mapError((cause) => new PaperUnavailable({ operation: "metadata", cause })),
      )

      // One request for a copy's file: its bytes, and where they came from
      // after redirects.
      const fetched = (url: string) =>
        client.get(url).pipe(
          Effect.flatMap((response) =>
            Effect.map(bodyOf(response, 20 * 1024 * 1024), (bytes) => ({
              bytes,
              url: response.url || url,
            })),
          ),
        )

      // A PubMed Central article's PDF in PMC's bucket: of the article's
      // deposits, the first, highest number first, that is the version the
      // copy names and has a PDF.
      const deposited = Effect.fnUntraced(function* (article: Article) {
        const listing = yield* client.get(listingOf(article.pmcid)).pipe(
          Effect.flatMap((response) => bodyOf(response, 1024 * 1024)),
          Effect.map((bytes) => new TextDecoder().decode(bytes)),
        )

        for (const number of depositsOf(listing, article.pmcid)) {
          const deposit = yield* client.get(metadataOf(article.pmcid, number)).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Deposit)),
            Effect.catchTag("SchemaError", () =>
              Effect.fail("PMC's metadata for the article did not decode"),
            ),
          )

          const url = pdfUrlOf(deposit, article)

          if (url !== undefined) return yield* fetched(url)
        }

        return yield* Effect.fail("PMC's bucket holds no PDF of this version")
      })

      // The copy's PDF: a PubMed Central copy's from PMC's bucket, any
      // other's from its PDF URL. When a PDF URL answers a landing page
      // instead, follows the page's `citation_pdf_url` tag once, to the same
      // site.
      const download = Effect.fn("OpenAlex.download")(
        function* (copy: Copy) {
          const article = articleOf(copy)

          if (article !== undefined) {
            const found = yield* deposited(article)

            if (!isPdf(found.bytes)) return yield* Effect.fail("Copy did not return a PDF")

            return { ...found, landing: null, retrievedAt: yield* now }
          }

          const first = yield* fetched(copy.pdf_url)

          if (isPdf(first.bytes)) return { ...first, landing: null, retrievedAt: yield* now }
          const html = new TextDecoder().decode(first.bytes)
          const link = linkOf(html, { page: first.url, copy })

          if (link === undefined) return yield* Effect.fail("Copy did not return a PDF")
          const linked = yield* fetched(link)

          if (!isPdf(linked.bytes))
            return yield* Effect.fail("Landing page's PDF link did not return a PDF")

          return { ...linked, landing: first.url, retrievedAt: yield* now }
        },
        Effect.timeout("15 seconds"),
        Effect.mapError(
          (cause) => new PaperUnavailable({ operation: "download", cause: briefOf(cause) }),
        ),
      )

      return OpenAlex.of({ lookup, page, works, download })
    }),
  )
}
