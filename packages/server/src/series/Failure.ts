import { type Source, SourceUnavailable } from "@repo/domain"
import { Effect } from "effect"

import type { Ended } from "./Failure.types.ts"
import { failureOf } from "./utils/failureOf.ts"

// Logs what a request to `url` ended with, then fails as the source being
// unavailable with what it did. The log keeps the error; clients get only
// the failure, never the answer's body.
export const unavailable =
  (source: Source, url: string) =>
  <A, R>(effect: Effect.Effect<A, Ended, R>): Effect.Effect<A, SourceUnavailable, R> =>
    effect.pipe(
      Effect.tapError((error) =>
        Effect.logWarning(`${source} request failed`, url, failureOf(error), error),
      ),
      Effect.mapError((error) => new SourceUnavailable({ source, failure: failureOf(error) })),
    )
