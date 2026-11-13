import { Cause, Effect, Predicate, Stream } from "effect"
import type { HttpClientError, HttpClientResponse } from "effect/http"

// A request's failure in a few words, without its URL: the status a host
// answered, a timeout, or no answer at all.
export const briefOf = (cause: HttpClientError.HttpClientError | Cause.TimeoutError | string) => {
  if (Predicate.isString(cause)) return cause

  if (Cause.isTimeoutError(cause)) return "Timed out"

  return cause.response === undefined ? "No response" : `HTTP ${cause.response.status}`
}

// The bound applies to bytes received, including chunked responses.
export const bodyOf = (response: HttpClientResponse.HttpClientResponse, limit: number) =>
  Effect.gen(function* () {
    const chunks: Array<Uint8Array> = []
    let size = 0
    yield* response.stream.pipe(
      Stream.runForEach((chunk) => {
        size += chunk.length

        if (size > limit) return Effect.fail(`Response exceeds ${limit} bytes`)
        chunks.push(chunk)

        return Effect.void
      }),
    )
    const bytes = new Uint8Array(size)
    let offset = 0

    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }

    return bytes
  })
