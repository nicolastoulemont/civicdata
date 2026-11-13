import { AwsClient } from "aws4fetch"
import { Effect, Redacted } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

import type { SeriesBucket } from "../src/series/Store.ts"

export const storage = Effect.fn("Ilostat.storage")(function* ({
  account,
  accessKeyId,
  secretAccessKey,
  bucket,
}: {
  readonly account: string
  readonly accessKeyId: Redacted.Redacted
  readonly secretAccessKey: Redacted.Redacted
  readonly bucket: string
}) {
  const client = yield* HttpClient.HttpClient

  const signer = new AwsClient({
    accessKeyId: Redacted.value(accessKeyId),
    secretAccessKey: Redacted.value(secretAccessKey),
    service: "s3",
    region: "auto",
  })

  const base = `https://${account}.r2.cloudflarestorage.com/${encodeURIComponent(bucket)}`
  const url = (key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`

  const request = Effect.fn("R2.request")(function* (
    key: string,
    init: { method: "GET" | "PUT" | "DELETE"; headers?: Headers; body?: string },
  ) {
    const signed = yield* Effect.tryPromise(() => signer.sign(url(key), init))
    const outgoing = HttpClientRequest.fromWeb(signed)

    return yield* client.execute(
      init.body !== undefined
        ? outgoing.pipe(
            HttpClientRequest.bodyText(init.body, signed.headers.get("content-type") ?? undefined),
          )
        : outgoing,
    )
  })

  const bucketTransport: SeriesBucket = {
    get: (key) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const response = yield* request(key, { method: "GET" })

          if (response.status === 404) return null

          if (response.status !== 200) return yield* Effect.fail("R2 GET failed")
          const text = yield* response.text

          const customMetadata = Object.fromEntries(
            Object.entries(response.headers)
              .filter(([name]) => name.startsWith("x-amz-meta-"))
              .map(([name, value]) => [name.slice("x-amz-meta-".length), value]),
          )

          return { text: () => Promise.resolve(text), customMetadata }
        }),
      ),
    put: (key, value, options) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const headers = new Headers(
            Object.entries(options.customMetadata).map(([name, item]) => [
              `x-amz-meta-${name}`,
              item,
            ]),
          )

          if (options.onlyIf !== undefined)
            headers.set("if-none-match", options.onlyIf.etagDoesNotMatch)
          const response = yield* request(key, { method: "PUT", headers, body: value })

          if (response.status === 412 && options.onlyIf !== undefined) return null

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
            request(key, { method: "DELETE" }).pipe(
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
