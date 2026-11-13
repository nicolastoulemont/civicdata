// Starts one instance of a stage's Workflow through the Cloudflare API, with
// CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN set, and answers the
// instance's id. `workflow` is the name's last part in
// packages/infra/alchemy.run.ts: civicdata-<stage>-<workflow>.
import { Config, Effect, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

const Created = Schema.Struct({ result: Schema.Struct({ id: Schema.String }) })

export const start = Effect.fn(function* (
  stage: string,
  { workflow, params }: { readonly workflow: string; readonly params: unknown },
) {
  const account = yield* Config.String("CLOUDFLARE_ACCOUNT_ID")
  const token = yield* Config.Redacted("CLOUDFLARE_API_TOKEN")
  const name = `civicdata-${stage.toLowerCase().replaceAll(/[^a-z0-9-]/g, "-")}-${workflow}`
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

  const { result } = yield* client
    .execute(
      HttpClientRequest.post(
        `https://api.cloudflare.com/client/v4/accounts/${account}/workflows/${name}/instances`,
      ).pipe(
        HttpClientRequest.bearerToken(Redacted.value(token)),
        HttpClientRequest.bodyJsonUnsafe({ params }),
      ),
    )
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Created)))

  yield* Effect.logInfo(`Started ${name} instance ${result.id}`)

  return result.id
})
