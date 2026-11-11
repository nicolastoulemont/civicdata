// Prints the answers of the last DAYS days (7 unless set) worth turning into
// eval cases, worst first, each as the start of a case for eval/cases.ts.
// It reads a stage's answer log through Cloudflare's D1 API, with a token
// that can read D1:
//
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... DATABASE_ID=... \
//     pnpm --filter @civicdata/server run triage
//
// DATABASE_ID is the stage's D1 database, under Storage and databases, then
// D1, in the Cloudflare dashboard. docs/answers.md says how to finish a case.
import { Config, DateTime, Duration, Effect, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

import { candidates, Logged, print } from "../eval/candidates.ts"

const Query = Schema.Struct({ sql: Schema.String, params: Schema.Array(Schema.String) })

// The D1 API's answer to one statement.
const Answer = Schema.Struct({
  result: Schema.Tuple([Schema.Struct({ results: Schema.Array(Logged) })]),
})

const program = Effect.gen(function* () {
  const account = yield* Config.String("CLOUDFLARE_ACCOUNT_ID")
  const token = yield* Config.Redacted("CLOUDFLARE_API_TOKEN")
  const database = yield* Config.String("DATABASE_ID")
  const days = yield* Config.Int("DAYS").pipe(Config.withDefault(7))

  const since = DateTime.subtractDuration(yield* DateTime.now, Duration.days(days))

  const request = yield* HttpClientRequest.post(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,
  ).pipe(
    HttpClientRequest.bearerToken(token),
    HttpClientRequest.schemaBodyJson(Query)({
      sql: "SELECT * FROM answers WHERE asked >= ?",
      params: [DateTime.formatIso(since)],
    }),
  )

  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

  const {
    result: [{ results }],
  } = yield* client.execute(request).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Answer)))

  const listed = candidates(results)

  for (const candidate of listed) {
    yield* Effect.sync(() => console.log(`${print(candidate)}\n`))
  }

  yield* Effect.logInfo(`${listed.length} of ${results.length} answers since ${days} days ago`)
})

await Effect.runPromise(program.pipe(Effect.provide(FetchHttpClient.layer)))
