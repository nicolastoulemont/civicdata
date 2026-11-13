import { Clock, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"

import { fingerprint } from "../../src/fingerprint.ts"
import { type Mode, Seed, Work } from "../../src/research/archive.ts"
import { metadataUrl, OpenAlex } from "./openalex.ts"

const Search = Schema.Struct({
  query: Schema.String,
  url: Schema.String,
  retrievedAt: Schema.String,
  works: Schema.Array(Work),
})

const Catalogue = Schema.Struct({ format: Schema.Literal(2), searches: Schema.Array(Search) })

const topics = [
  {
    query:
      '"minimum wage" OR "fiscal multipliers" OR "pension reform" OR "democracy economic growth"',
    repository: true,
  },
  { query: "minimum wage employment", repository: false },
  { query: "fiscal multipliers", repository: false },
  { query: "pension reform employment", repository: false },
  { query: "democracy economic growth", repository: false },
  { query: "carbon pricing emissions synthetic control", repository: false },
  { query: "retirement regression discontinuity", repository: false },
  ...[
    "fiscal multipliers",
    "pension reform retirement employment",
    "carbon tax emissions",
    "minimum wage difference differences",
  ].map((query) => ({ query, repository: true })),
]

const searchUrl = ({ query, repository }: (typeof topics)[number]) => {
  const url = new URL("https://api.openalex.org/works")
  url.searchParams.set("search", query)
  url.searchParams.set(
    "filter",
    "is_oa:true,is_retracted:false,language:en,from_publication_date:1990-01-01" +
      (repository ? ",locations.source.id:S4306401696" : ""),
  )
  url.searchParams.set("per-page", "20")

  return url.href
}

const search = Effect.fn("Papers.search")(function* (
  topic: (typeof topics)[number],
  options: { directory: string; refresh: boolean },
) {
  const fs = yield* FileSystem
  const source = yield* OpenAlex
  const url = searchUrl(topic)
  const path = `${options.directory}/query-${yield* fingerprint(url)}.json`
  const codec = Schema.fromJsonString(Search)

  if (!options.refresh && (yield* fs.exists(path))) {
    return yield* fs.readFileString(path).pipe(Effect.flatMap(Schema.decodeUnknownEffect(codec)))
  }

  const found = Search.make({
    query: topic.query,
    url,
    works: yield* source.search(url),
    retrievedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
  })

  yield* fs.makeDirectory(options.directory, { recursive: true })
  yield* fs.writeFileString(`${path}.tmp`, yield* Schema.encodeEffect(codec)(found))
  yield* fs.rename(`${path}.tmp`, path)

  return found
})

// Each completed search is saved separately: a failed query never makes a
// resumed run fetch another query again. The complete manifest feeds replay.
export const discover = Effect.fn("Papers.discover")(function* (directory: string, mode: Mode) {
  const fs = yield* FileSystem
  const path = `${directory}/discovery.json`
  const codec = Schema.fromJsonString(Catalogue)

  const catalogue = yield* mode === "Offline"
    ? fs.readFileString(path).pipe(Effect.flatMap(Schema.decodeUnknownEffect(codec)))
    : Effect.gen(function* () {
        const searches = yield* Effect.forEach(topics, (topic) =>
          search(topic, { directory, refresh: mode === "Refresh" }),
        )

        const found = Catalogue.make({ format: 2, searches })
        const encoded = yield* Schema.encodeEffect(codec)(found)
        const unchanged = (yield* fs.exists(path)) && (yield* fs.readFileString(path)) === encoded

        if (!unchanged) {
          yield* fs.writeFileString(`${path}.tmp`, encoded)
          yield* fs.rename(`${path}.tmp`, path)
        }

        return found
      })

  const works = [
    ...new Map(
      catalogue.searches.flatMap((entry) => entry.works).map((work) => [work.id, work]),
    ).values(),
  ]

  const seeds = yield* Effect.forEach(works, (work) =>
    Effect.gen(function* () {
      const doi = work.doi?.replace(/^https:\/\/doi.org\//i, "") ?? null

      const seed = yield* Seed.makeEffect({
        id: yield* fingerprint(work.id),
        openalex: work.id,
        study: {
          title: work.title,
          year: work.publication_year,
          doi,
          authors: work.authorships.flatMap(({ author }) =>
            author.display_name === null ? [] : [author.display_name],
          ),
          publisher:
            work.locations.find((location) => location.raw_source_name)?.raw_source_name ?? null,
          url: work.id,
        },
      })

      return { seed, work, metadataUrl: metadataUrl(work.id) }
    }),
  )

  return { catalogue, seeds }
})
