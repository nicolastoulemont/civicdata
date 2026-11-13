import { Clock, Effect, Option, Schema } from "effect"

import {
  Attempt,
  Content,
  Paper,
  PaperUnavailable,
  type Mode,
  type Seed,
  type Work,
} from "../../src/research/archive.ts"
import { gatherCopies } from "./copies.ts"
import { metadataUrl, OpenAlex } from "./openalex.ts"
import { Papers } from "./storage.ts"

const matches = (seed: Seed, work: Work) =>
  seed.openalex === null
    ? work.doi?.toLowerCase() === `https://doi.org/${seed.study.doi?.toLowerCase()}`
    : work.id === seed.openalex

const exclusion = (seed: Seed, work: Work | null) => {
  if (work === null)
    return seed.openalex === null && seed.study.doi === null ? "no-doi" : "not-found"

  if (!matches(seed, work)) return "different-doi"

  if (work.is_retracted) return "retracted"

  return null
}

interface Options {
  readonly mode?: Mode
  readonly found?: Work
}

const complete = (paper: Paper) =>
  Content.guards.Text(paper.content) ||
  !paper.attempts.some(({ result }) => Attempt.fields.result.guards.Failed(result))

const stable = (paper: Paper) =>
  JSON.stringify(Schema.encodeSync(Schema.toCodecJson(Paper))(paper), (key, value: Schema.Json) =>
    key === "retrievedAt" ? undefined : value,
  )

export const gather = Effect.fn("Papers.gather")(function* (seed: Seed, options: Options = {}) {
  const mode = options.mode ?? "Resume"
  const papers = yield* Papers
  const previous = yield* papers.read(seed)
  const old = Option.getOrNull(previous)

  if (
    old !== null &&
    mode !== "Refresh" &&
    (complete(old) || mode === "Offline") &&
    JSON.stringify(old.seed) === JSON.stringify(seed) &&
    (options.found === undefined || JSON.stringify(old.work) === JSON.stringify(options.found))
  ) {
    return { written: false, paper: old }
  }

  if (mode === "Offline") {
    return yield* new PaperUnavailable({ operation: "offline", cause: "No completed checkpoint" })
  }

  const source = yield* OpenAlex
  const work = options.found ?? (yield* source.lookup(seed))
  const reason = exclusion(seed, work)

  const gathered =
    reason !== null || work === null
      ? {
          content: Content.cases.Metadata.make({ reason: reason ?? "not-found" }),
          attempts: [],
          pdf: null,
        }
      : yield* gatherCopies(work, { previous: old, refresh: mode === "Refresh" })

  const identity = seed.openalex ?? seed.study.doi

  const { pdf, ...record } = gathered

  const paper = Paper.make({
    format: 3,
    seed,
    metadataUrl: identity === null ? null : metadataUrl(identity),
    retrievedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    work,
    ...record,
  })

  if (old !== null && stable(old) === stable(paper)) return { written: false, paper: old }
  yield* papers.write(paper, { pdf })

  return { written: true, paper }
})
