import { Clock, Context, Effect, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

import { Copy, PaperUnavailable, type Seed, Work } from "../../src/research/archive.ts"
import { bodyOf } from "./http.ts"

export interface Download {
  readonly bytes: Uint8Array
  readonly url: string
  readonly retrievedAt: string
}

interface Interface {
  readonly lookup: (seed: {
    readonly openalex: Seed["openalex"]
    readonly study: Pick<Seed["study"], "doi">
  }) => Effect.Effect<Work | null, PaperUnavailable>
  readonly search: (url: string) => Effect.Effect<ReadonlyArray<Work>, PaperUnavailable>
  readonly download: (copy: Copy) => Effect.Effect<Download, PaperUnavailable>
}

export const metadataUrl = (identity: string) =>
  `https://api.openalex.org/works/${encodeURIComponent(identity.startsWith("https://openalex.org/") ? identity : `https://doi.org/${identity}`)}`

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

      const search = Effect.fn("OpenAlex.search")(
        function* (url: string) {
          const response = yield* client.get(url)

          const result = yield* HttpClientResponse.schemaBodyJson(
            Schema.Struct({ results: Schema.Array(Work) }),
          )(response)

          return result.results
        },
        Effect.timeout("30 seconds"),
        Effect.mapError((cause) => new PaperUnavailable({ operation: "discovery", cause })),
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

      return OpenAlex.of({ lookup, search, download })
    }),
  )
}
