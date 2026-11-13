// Publication of a corpus directory: copies every gathered record into a
// stage's paper store (docs/papers.md), through the writer the gather uses.
// It runs on a machine and asks no model: annotations come from the corpus.
import { Data, Effect, Match } from "effect"

import { write } from "../../src/research/publication.ts"
import { type Failure, Published } from "../../src/research/publication.types.ts"
import { tables } from "../../src/research/store.ts"
import { type CorpusInvalid, recordOf, records } from "./corpus.ts"

// What publication did for one paper of the corpus.
export type Publication = Data.TaggedEnum<{
  Unchanged: {}
  Written: { readonly version: string | null; readonly annotation: string | null }
  Failed: { readonly problem: string }
}>

export const Publication = Data.taggedEnum<Publication>()

const problemOf = (error: CorpusInvalid | Failure) =>
  Match.valueTags(error, {
    CorpusInvalid: ({ file, problem }) => `${file}: ${problem}`,
    BucketUnavailable: ({ operation, key, problem }) => `R2 ${operation} ${key}: ${problem}`,
    Refused: ({ problem }) => problem,
    ObjectMismatch: ({ key }) => `R2 holds other bytes at ${key}`,
    SqlError: (sql) => `${sql.message}: ${String(sql.reason.cause)}`,
    SchemaError: ({ message }) => message,
  })

const one = (file: string, { directory }: { readonly directory: string }) =>
  recordOf(file, { directory }).pipe(
    Effect.flatMap(write),
    Effect.map((outcome): Publication =>
      Published.$match(outcome, {
        Unchanged: () => Publication.Unchanged(),
        Written: (written) => Publication.Written(written),
      }),
    ),
    Effect.catch((error) => Effect.succeed(Publication.Failed({ problem: problemOf(error) }))),
    Effect.map((outcome) => ({ file, outcome })),
  )

// Publishes every paper of a corpus directory. A paper whose rows already
// match is skipped without a write, and one paper's failure never stops or
// repeats another's, so the next run retries only the papers that failed.
export const publish = Effect.fn("Papers.publish")(function* (directory: string) {
  yield* tables
  const files = yield* records(directory)

  return yield* Effect.forEach(files, (file) => one(file, { directory }), { concurrency: 4 })
})
