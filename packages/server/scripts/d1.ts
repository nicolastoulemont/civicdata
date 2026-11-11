// A SqlClient over Cloudflare's D1 HTTP API, for scripts that run on a
// machine: one request per statement. Inside Workers the D1 binding answers
// (@effect/sql-d1); this sends the same SQL, compiled the same way.
import { Context, Effect, Layer, Redacted, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import * as Reactivity from "effect/reactivity/Reactivity"
import { SqlClient, SqlError, Statement } from "effect/sql"
import type { SqlConnection } from "effect/sql"

const Meta = Schema.Struct({ rows_read: Schema.Finite, rows_written: Schema.Finite })

const Answer = Schema.Struct({
  result: Schema.Tuple([
    Schema.Struct({
      results: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
      meta: Meta,
    }),
  ]),
})

const RawAnswer = Schema.Struct({
  result: Schema.Tuple([
    Schema.Struct({
      results: Schema.Struct({ rows: Schema.Array(Schema.Array(Schema.Unknown)) }),
      meta: Meta,
    }),
  ]),
})

// The rows every statement so far read and wrote, as D1 counted them.
interface Usage {
  read: number
  written: number
}

export interface Target {
  readonly account: string
  readonly database: string
  readonly token: Redacted.Redacted
}

const failed = (cause: unknown) =>
  new SqlError.SqlError({
    reason: new SqlError.UnknownError({
      cause: Schema.is(Schema.String)(cause) ? cause : "D1 request failed",
      message: "D1's HTTP API refused the statement",
    }),
  })

// The client, and what it counts.
export const d1 = ({ account, database, token }: Target) => {
  const usage: Usage = { read: 0, written: 0 }

  const layer = Layer.effectContext(
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const base = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}`

      const send = <A extends { readonly result: readonly [{ readonly meta: typeof Meta.Type }] }>(
        path: "query" | "raw",
        {
          sql,
          params,
          schema,
        }: { sql: string; params: ReadonlyArray<unknown>; schema: Schema.Codec<A, unknown> },
      ) =>
        HttpClientRequest.post(`${base}/${path}`).pipe(
          HttpClientRequest.bearerToken(token),
          HttpClientRequest.bodyJsonUnsafe({ sql, params }),
          http.execute,
          Effect.flatMap((response) =>
            Effect.gen(function* () {
              if (response.status < 200 || response.status >= 300) {
                const body = yield* response.text

                return yield* Effect.fail(`D1 answered ${response.status}: ${body.slice(0, 1000)}`)
              }

              return yield* HttpClientResponse.schemaBodyJson(schema)(response)
            }),
          ),
          Effect.tap(({ result: [{ meta }] }) =>
            Effect.sync(() => {
              usage.read += meta.rows_read
              usage.written += meta.rows_written
            }),
          ),
          Effect.mapError(failed),
        )

      const rows = (sql: string, params: ReadonlyArray<unknown>) =>
        send("query", { sql, params, schema: Answer }).pipe(
          Effect.map(({ result: [{ results }] }) => results),
        )

      const values = (sql: string, params: ReadonlyArray<unknown>) =>
        send("raw", { sql, params, schema: RawAnswer }).pipe(
          Effect.map(({ result: [{ results }] }) => results.rows),
        )

      const connection: SqlConnection.Connection = {
        execute: (sql, params, transform) =>
          transform === undefined ? rows(sql, params) : Effect.map(rows(sql, params), transform),
        executeRaw: (sql, params) => send("query", { sql, params, schema: Answer }),
        executeStream: () => Stream.die("D1's HTTP API does not stream"),
        executeValues: values,
        executeValuesUnprepared: values,
        executeUnprepared: (sql, params, transform) =>
          transform === undefined ? rows(sql, params) : Effect.map(rows(sql, params), transform),
      }

      const client = yield* SqlClient.make({
        driver: "d1-http",
        acquirer: Effect.succeed(connection),
        compiler: Statement.makeCompilerSqlite(),
        transactionAcquirer: Effect.die("D1's HTTP API runs no transactions"),
        spanAttributes: [],
      })

      return Context.make(SqlClient.SqlClient, client)
    }),
  ).pipe(Layer.provide(Reactivity.layer))

  return { layer, usage }
}
