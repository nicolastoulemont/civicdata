import { Effect, Redacted } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

import type { SeriesBucket } from "../src/Store.ts"

export const storage = Effect.fn("Ilostat.storage")(function* ({
  account,
  token,
  bucket,
}: {
  readonly account: string
  readonly token: Redacted.Redacted
  readonly bucket: string
}) {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(HttpClientRequest.bearerToken(Redacted.value(token))),
  )

  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${encodeURIComponent(bucket)}/objects`
  const url = (key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`

  const bucketTransport: SeriesBucket = {
    get: (key) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const response = yield* client.get(url(key))

          if (response.status === 404) return null

          if (response.status !== 200) return yield* Effect.fail("R2 GET failed")
          const text = yield* response.text

          return { text: () => Promise.resolve(text) }
        }),
      ),
    put: (key, value) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const response = yield* client.execute(
            HttpClientRequest.put(url(key)).pipe(HttpClientRequest.bodyText(value)),
          )

          if (response.status < 200 || response.status >= 300)
            return yield* Effect.fail("R2 PUT failed")

          return { key }
        }),
      ),
    delete: (keys) =>
      Effect.runPromise(
        Effect.forEach(
          keys,
          (key) =>
            client.del(url(key)).pipe(
              Effect.filterOrFail(
                (response) => response.status >= 200 && response.status < 300,
                () => "R2 DELETE failed",
              ),
            ),
          { discard: true },
        ),
      ),
  }

  return bucketTransport
})
