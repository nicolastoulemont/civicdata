import { Effect } from "effect"

import { Attempt, Content, type Mode, type Seed, type Work } from "../../src/research/archive.ts"
import { discover } from "./discovery.ts"
import { gather } from "./gather.ts"
import { seeds } from "./seeds.ts"

const one = (seed: Seed, options: { mode: Mode; found: Work | null }) =>
  gather(
    seed,
    options.found === null ? { mode: options.mode } : { mode: options.mode, found: options.found },
  ).pipe(
    Effect.map(({ written, paper }) => ({
      id: seed.id,
      title: seed.study.title,
      authors: seed.study.authors,
      written,
      metadataUrl: paper.metadataUrl,
      retrievedAt: paper.retrievedAt,
      work: paper.work,
      attempts: paper.attempts,
      content: Content.match(paper.content, {
        Metadata: (content) => content,
        Text: ({ passages, ...content }) => ({ ...content, passages: passages.length }),
      }),
    })),
    Effect.catchTag("PaperUnavailable", (error) =>
      Effect.succeed({
        id: seed.id,
        title: seed.study.title,
        failed: error.operation,
        problem: String(error.cause),
      }),
    ),
  )

type Result = Effect.Success<ReturnType<typeof one>>

const unresolved = (result: Result) =>
  "failed" in result ||
  (Content.guards.Metadata(result.content) &&
    result.attempts.some((attempt) => Attempt.fields.result.guards.Failed(attempt.result)))

interface Options {
  readonly mode?: Mode
  readonly corpus?: "Topics" | "Seeds"
}

// The command's seam: inputs come from saved discovery, publications use
// per-copy receipts, and the returned report contains no paper passages.
export const collect = Effect.fn("Papers.collect")(function* (
  directory: string,
  options: Options = {},
) {
  const mode = options.mode ?? "Resume"
  const discovery = options.corpus === "Seeds" ? null : yield* discover(directory, mode)

  const inputs =
    discovery === null
      ? (yield* seeds).map((seed) => ({ seed, found: null }))
      : discovery.seeds.map(({ seed, work }) => ({ seed, found: work }))

  const results = yield* Effect.forEach(inputs, ({ seed, found }) => one(seed, { mode, found }), {
    concurrency: 2,
  })

  return {
    discovery:
      discovery?.catalogue.searches.map(({ works, query, url, retrievedAt }) => ({
        query,
        url,
        retrievedAt,
        results: works.length,
      })) ?? [],
    unresolved: results.filter(unresolved).length,
    results,
  }
})
