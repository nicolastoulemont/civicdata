import { Failure } from "@repo/domain"
import { Cause, Match } from "effect"

import type { Ended } from "../Failure.types.ts"

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
