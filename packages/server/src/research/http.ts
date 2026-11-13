import { Effect, Stream } from "effect"
import type { HttpClientResponse } from "effect/http"

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
