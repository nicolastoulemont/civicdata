// Fills a stage's catalog with the outline of every Eurostat dataset and OECD
// dataflow and the label of every code they use, from the five files both
// sources publish in bulk (docs/catalog.md). A catalog Workflow cannot: two
// of them outgrow a Worker's memory. Run it once per stage, then start a
// catalog build, which leaves out of search the datasets no chart can show
// and embeds the labels:
//
//   STAGE=pr-152 pnpm --filter @repo/server run outlines
//
// It writes to the stage's own database, civicdata-Database-<STAGE>-*, as
// Alchemy's default Cloudflare login (~/.alchemy/profiles/default/
// cloudflare.json). Running it again writes only what changed.
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { Config, Duration, Effect, Layer, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { SqlClient } from "effect/sql"

import { tables } from "../src/catalog/Catalog.ts"
import { Outlines } from "../src/series/Outlines.ts"
import { fill, Structures } from "../src/sources/sdmx/Structures.ts"
import { d1 } from "./d1.ts"

const Profile = Schema.fromJsonString(
  Schema.Struct({
    values: Schema.Struct({
      access: Schema.String,
      accountId: Schema.String,
      expires: Schema.Finite,
    }),
  }),
)

const Databases = Schema.Struct({
  result: Schema.Array(Schema.Struct({ uuid: Schema.String, name: Schema.String })),
})

// Alchemy's login, read here and never printed.
const login = Effect.gen(function* () {
  const text = yield* Effect.try(() =>
    readFileSync(join(homedir(), ".alchemy/profiles/default/cloudflare.json"), "utf8"),
  )

  const { values } = yield* Schema.decodeEffect(Profile)(text).pipe(
    Effect.mapError(() => "Cannot decode Alchemy's Cloudflare login"),
  )

  if (values.expires <= Date.now()) {
    return yield* Effect.fail(
      "Alchemy's Cloudflare login expired. Refresh it with: pnpm --silent --filter @repo/infra exec alchemy state cat civicdata/prod/output --log-level=none --no-input",
    )
  }

  return { account: values.accountId, token: Redacted.make(values.access) }
})

// The stage's database. D1 statement metadata gives its current size.
const find = Effect.fn("outlines.find")(function* ({
  account,
  token,
  stage,
}: {
  account: string
  token: Redacted.Redacted
  stage: string
}) {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

  const { result } = yield* HttpClientRequest.get(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database?per_page=100`,
  ).pipe(
    HttpClientRequest.bearerToken(token),
    client.execute,
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Databases)),
    Effect.mapError(() => "Cannot list stage databases with Alchemy's Cloudflare login"),
  )

  const found = result.filter(({ name }) => name.startsWith(`civicdata-Database-${stage}-`))

  if (found.length !== 1) {
    return yield* Effect.fail(`Found ${found.length} databases for the stage ${stage}`)
  }

  return found[0] ?? (yield* Effect.die("unreachable"))
})

const program = Effect.gen(function* () {
  const stage = yield* Config.String("STAGE")
  const { account, token } = yield* login
  const before = yield* find({ account, token, stage })
  const { layer, usage } = d1({ account, database: before.uuid, token })
  const started = Date.now()

  const { filled, sizeBefore } = yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`SELECT 1`

    const initialSize = usage.size

    yield* tables

    const eurostat = yield* fill("Eurostat")
    const oecd = yield* fill("OECD")

    return { filled: { Eurostat: eurostat, OECD: oecd }, sizeBefore: initialSize }
  }).pipe(
    Effect.provide(
      Layer.mergeAll(Outlines.layer, Structures.layer).pipe(Layer.provideMerge(layer)),
    ),
  )

  yield* Effect.logInfo("Filled", before.name, {
    ...filled,
    rowsRead: usage.read,
    rowsWritten: usage.written,
    took: Duration.format(Duration.millis(Date.now() - started)),
    sizeBefore,
    sizeAfter: usage.size,
  })
})

await Effect.runPromise(program.pipe(Effect.provide(FetchHttpClient.layer)))
