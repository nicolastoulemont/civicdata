// A stage's PAPERS bucket, as the store's writers use it: through the
// Worker's binding, or over Cloudflare's R2 API from a machine.
import { Context, Effect, Layer, Option, Redacted } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

import { BucketUnavailable } from "./Bucket.schemas.ts"

interface Interface {
  readonly get: (key: string) => Effect.Effect<Option.Option<Uint8Array>, BucketUnavailable>
  readonly put: (key: string, body: Uint8Array) => Effect.Effect<void, BucketUnavailable>
  readonly remove: (key: string) => Effect.Effect<void, BucketUnavailable>
}

// The message names the URL and status, never the token.
const failed =
  (operation: string, key: string) =>
  ({ message }: { readonly message: string }) =>
    new BucketUnavailable({ operation, key, problem: message })

interface Target {
  readonly account: string
  readonly bucket: string
  readonly token: Redacted.Redacted
}

// What a writer uses of an R2 bucket binding.
interface Binding {
  readonly get: (
    key: string,
  ) => Promise<{ readonly arrayBuffer: () => Promise<ArrayBuffer> } | null>
  readonly put: (key: string, body: Uint8Array) => Promise<object | null>
  readonly delete: (key: string) => Promise<void>
}

const thrown = (operation: string, key: string) => (cause: unknown) =>
  new BucketUnavailable({
    operation,
    key,
    problem: cause instanceof Error ? cause.message : "R2 failed",
  })

export class Bucket extends Context.Service<Bucket, Interface>()("papers/Bucket") {
  // The Worker's PAPERS binding.
  static readonly binding = (bucket: Binding) =>
    Layer.succeed(
      Bucket,
      Bucket.of({
        get: (key) =>
          Effect.tryPromise({
            try: async () => {
              const object = await bucket.get(key)

              return object === null
                ? Option.none()
                : Option.some(new Uint8Array(await object.arrayBuffer()))
            },
            catch: thrown("get", key),
          }),
        put: (key, body) =>
          Effect.tryPromise({ try: () => bucket.put(key, body), catch: thrown("put", key) }).pipe(
            Effect.asVoid,
          ),
        remove: (key) =>
          Effect.tryPromise({ try: () => bucket.delete(key), catch: thrown("remove", key) }),
      }),
    )

  // No retry: a failed request fails its paper, and the next run retries
  // that paper alone.
  static readonly r2 = ({ account, bucket, token }: Target) =>
    Layer.effect(
      Bucket,
      Effect.gen(function* () {
        const client = (yield* HttpClient.HttpClient).pipe(
          HttpClient.mapRequest(HttpClientRequest.bearerToken(Redacted.value(token))),
        )

        const base = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${encodeURIComponent(bucket)}/objects`
        const url = (key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`

        const get = (key: string) =>
          client.get(url(key)).pipe(
            Effect.flatMap((response) =>
              response.status === 404
                ? Effect.succeedNone
                : HttpClientResponse.filterStatusOk(response).pipe(
                    Effect.flatMap((ok) => ok.arrayBuffer),
                    Effect.map((bytes) => Option.some(new Uint8Array(bytes))),
                  ),
            ),
            Effect.mapError(failed("get", key)),
          )

        const put = (key: string, body: Uint8Array) =>
          client
            .execute(HttpClientRequest.put(url(key)).pipe(HttpClientRequest.bodyUint8Array(body)))
            .pipe(
              Effect.flatMap(HttpClientResponse.filterStatusOk),
              Effect.asVoid,
              Effect.mapError(failed("put", key)),
            )

        // An object already gone is removed.
        const remove = (key: string) =>
          client.execute(HttpClientRequest.delete(url(key))).pipe(
            Effect.flatMap((response) =>
              response.status === 404
                ? Effect.void
                : HttpClientResponse.filterStatusOk(response).pipe(Effect.asVoid),
            ),
            Effect.mapError(failed("remove", key)),
          )

        return Bucket.of({ get, put, remove })
      }),
    )
}
