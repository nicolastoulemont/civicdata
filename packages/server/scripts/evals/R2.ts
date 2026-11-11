import { Config, Effect, Layer, Option, Redacted, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

import { ArchiveError } from "./model.ts"
import { Store } from "./transfer.ts"

const Listed = Schema.Struct({
  result: Schema.Array(Schema.Struct({ key: Schema.String })),
  result_info: Schema.optionalKey(
    Schema.Struct({
      cursor: Schema.optionalKey(Schema.NullOr(Schema.String)),
      is_truncated: Schema.optionalKey(Schema.Boolean),
    }),
  ),
})

const failure = (operation: string) => (cause: { readonly message: string }) =>
  new ArchiveError({ operation, detail: cause.message })

// R2's Cloudflare API uses the same bearer credentials as infrastructure tools.
// Objects and manifests are content-addressed; this adapter exposes no delete.
export const r2 = Layer.effect(
  Store,
  Effect.gen(function* () {
    const account = yield* Config.schema(
      Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/)),
      "CLOUDFLARE_ACCOUNT_ID",
    )

    const token = yield* Config.Redacted("CLOUDFLARE_API_TOKEN")
    const bucket = yield* Config.String("EVALS_BUCKET").pipe(Config.withDefault("civicdata-evals"))
    const base = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${encodeURIComponent(bucket)}/objects`

    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(HttpClientRequest.bearerToken(Redacted.value(token))),
      // Both methods are idempotent: PUT keys are derived from their content.
      HttpClient.retryTransient({ times: 10, schedule: Schedule.spaced("30 seconds") }),
    )

    const url = (key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`

    const get = Effect.fn("Evals.R2.get")(
      function* (key: string) {
        const response = yield* client.get(url(key))

        if (response.status === 404) return Option.none()
        const ok = yield* HttpClientResponse.filterStatusOk(response)

        return Option.some(new Uint8Array(yield* ok.arrayBuffer))
      },
      Effect.mapError(failure("R2.get")),
    )

    const put = Effect.fn("Evals.R2.put")(
      function* (key: string, body: Uint8Array) {
        yield* client
          .execute(HttpClientRequest.put(url(key)).pipe(HttpClientRequest.bodyUint8Array(body)))
          .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk))
      },
      Effect.mapError(failure("R2.put")),
    )

    const list = Effect.fn("Evals.R2.list")(
      function* (prefix: string) {
        const keys: Array<string> = []
        let cursor = ""
        const seen = new Set<string>()

        while (true) {
          const query = new URLSearchParams({ prefix, per_page: "1000" })

          if (cursor !== "") query.set("cursor", cursor)

          const response = yield* client.get(`${base}?${query}`)

          const page = yield* HttpClientResponse.schemaBodyJson(Listed)(
            yield* HttpClientResponse.filterStatusOk(response),
          )

          keys.push(...page.result.map(({ key }) => key))

          const next = page.result_info?.cursor

          if (!next && !page.result_info?.is_truncated) break

          if (!next || seen.has(next)) {
            return yield* new ArchiveError({
              operation: "R2.list",
              detail: "Missing or repeated pagination cursor",
            })
          }

          seen.add(next)
          cursor = next
        }

        return keys
      },
      Effect.mapError((cause) =>
        Schema.is(ArchiveError)(cause) ? cause : failure("R2.list")(cause),
      ),
    )

    return Store.of({ get, put, list })
  }),
)
