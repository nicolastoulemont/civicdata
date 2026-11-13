// A stage's PAPERS bucket over Cloudflare's R2 API, for the publication
// command, which runs on a machine. Inside Workers the binding answers.
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

// R2 refused or failed a request for one object.
export class BucketUnavailable extends Schema.TaggedError<
  BucketUnavailable,
  { readonly brand: unique symbol }
>()("BucketUnavailable", {
  operation: Schema.String,
  key: Schema.String,
  problem: Schema.String,
}) {}

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

export class Bucket extends Context.Service<Bucket, Interface>()("papers/Bucket") {
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
