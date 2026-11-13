import { Clock, Context, Effect, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

import { Copy, PaperUnavailable, type Seed, Work } from "./archive.ts"
import { bodyOf } from "./http.ts"

export interface Download {
  readonly bytes: Uint8Array
  readonly url: string
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

// Open access, not retracted, in English, published from 1990; EconStor's
// repository (S4306401696) when the query keeps to it; updated from `since`
// when the query gives a day. OpenAlex moves a work's updated date whenever
// its record changes, citation counts included.
const filterOf = ({ repository, since }: Query) =>
  "is_oa:true,is_retracted:false,language:en,from_publication_date:1990-01-01" +
  (repository === true ? ",locations.source.id:S4306401696" : "") +
  (since === null || since === undefined ? "" : `,from_updated_date:${since}`)

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

export const copiesOf = (work: Work) => {
  const copies = work.locations.flatMap((location) =>
    Option.toArray(Schema.decodeUnknownOption(Copy)(location)),
  )

  // A copy's native id, URL and version stay separate from the catalogue's
  // work/DOI grouping. Duplicate listing rows do not cause duplicate downloads.
  return [
    ...new Map(copies.map((copy) => [`${copy.id}|${copy.version}|${copy.pdf_url}`, copy])).values(),
  ]
}

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

      const download = Effect.fn("OpenAlex.download")(
        function* (copy: Copy) {
          const response = yield* client.get(copy.pdf_url)
          const bytes = yield* bodyOf(response, 20 * 1024 * 1024)

          if (!new TextDecoder().decode(bytes.subarray(0, 5)).startsWith("%PDF-")) {
            return yield* Effect.fail("Copy did not return a PDF")
          }

          return {
            bytes,
            url: response.url || copy.pdf_url,
            retrievedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
          }
        },
        Effect.timeout("15 seconds"),
        Effect.mapError((cause) => new PaperUnavailable({ operation: "download", cause })),
      )

      return OpenAlex.of({ lookup, page, works, download })
    }),
  )
}
