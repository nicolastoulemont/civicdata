// Prints the answers worth turning into eval cases, worst first, each as the
// start of a case for eval/cases.ts. It reads them from one of two places.
//
// A stage's answer log, for the last DAYS days (7 unless set), through
// Cloudflare's D1 API, with a token that can read D1:
//
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... DATABASE_ID=... \
//     pnpm --filter @civicdata/server run triage
//
// DATABASE_ID is the stage's D1 database, under Storage and databases, then
// D1, in the Cloudflare dashboard. docs/answers.md says how to finish a case.
//
// Or a probe run's folder, once a reviewer has voted on its answers
// (eval/probes.md):
//
//   RUN=eval/runs/<run> pnpm --filter @civicdata/server run triage
import { readdir, readFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import { Config, DateTime, Duration, Effect, Option, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

import { candidates, Logged, print } from "../eval/candidates.ts"
import { Probed } from "../eval/probes.ts"

const Query = Schema.Struct({ sql: Schema.String, params: Schema.Array(Schema.String) })

// The D1 API's answer to one statement.
const Answer = Schema.Struct({
  result: Schema.Tuple([Schema.Struct({ results: Schema.Array(Logged) })]),
})

const ProbedJson = Schema.fromJsonString(Probed)

// The answers a stage logged in the last DAYS days.
const logged = Effect.gen(function* () {
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

  return { rows: results, from: `answers since ${days} days ago` }
})

// The answers of a probe run, every turn of every probe.
const probed = Effect.fnUntraced(function* (run: string) {
  const folder = resolve(run)
  const names = yield* Effect.promise(() => readdir(folder))

  const files = yield* Effect.forEach(
    names.filter((name) => name.endsWith(".json")),
    (name) =>
      Effect.promise(() => readFile(join(folder, name), "utf8")).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ProbedJson)),
      ),
  )

  return { rows: files.flatMap(({ rows }) => rows), from: `answers in ${run}` }
})

const program = Effect.gen(function* () {
  const run = yield* Config.option(Config.String("RUN"))
  const { rows, from } = yield* Option.match(run, { onNone: () => logged, onSome: probed })

  const listed = candidates(rows)

  for (const candidate of listed) {
    yield* Effect.sync(() => console.log(`${print(candidate)}\n`))
  }

  yield* Effect.logInfo(`${listed.length} of ${rows.length} ${from}`)
})

await Effect.runPromise(program.pipe(Effect.provide(FetchHttpClient.layer)))
