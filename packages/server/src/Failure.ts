import { Failure, type Source, SourceUnavailable } from "@openfacts/domain"
import { Cause, Effect, Match, Schema } from "effect"
import { HttpClientError } from "effect/http"

// What a request to a source can end with: the client's error, our deadline,
// a body that does not decode, or an adapter's own SourceUnavailable.
type Ended =
  | HttpClientError.HttpClientError
  | Cause.TimeoutError
  | Schema.SchemaError
  | SourceUnavailable

const statusOf = (status: number): Failure => {
  if (status === 429) return Failure.cases.RateLimited.make({})

  return status >= 500
    ? Failure.cases.ServerError.make({ status })
    : Failure.cases.Refused.make({ status })
}

// What the source did. A body that arrived but does not decode is
// Unreadable; one cut off while reading is Transport, like no answer at all.
// A SourceUnavailable without a failure is an adapter rejecting what the
// source answered.
export const failureOf = (error: Ended): Failure =>
  Match.valueTags(error, {
    TimeoutError: () => Failure.cases.Timeout.make({}),
    SchemaError: () => Failure.cases.Unreadable.make({}),
    SourceUnavailable: ({ failure }) => failure ?? Failure.cases.Unreadable.make({}),
    HttpClientError: ({ reason }) =>
      Match.valueTags(reason, {
        StatusCodeError: ({ response }) => statusOf(response.status),
        EmptyBodyError: () => Failure.cases.Unreadable.make({}),
        TransportError: ({ cause }) =>
          Cause.isTimeoutError(cause)
            ? Failure.cases.Timeout.make({})
            : Failure.cases.Transport.make({}),
        DecodeError: () => Failure.cases.Transport.make({}),
        EncodeError: () => Failure.cases.Transport.make({}),
        InvalidUrlError: () => Failure.cases.Transport.make({}),
      }),
  })

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
