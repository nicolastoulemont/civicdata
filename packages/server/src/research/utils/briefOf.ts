import { Cause, Predicate } from "effect"
import type { HttpClientError } from "effect/http"

// A request's failure in a few words, without its URL: the status a host
// answered, a timeout, or no answer at all.
export const briefOf = (cause: HttpClientError.HttpClientError | Cause.TimeoutError | string) => {
  if (Predicate.isString(cause)) return cause

  if (Cause.isTimeoutError(cause)) return "Timed out"

  return cause.response === undefined ? "No response" : `HTTP ${cause.response.status}`
}
