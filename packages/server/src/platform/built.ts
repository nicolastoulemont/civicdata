import { D1Client } from "@effect/sql-d1"
import { Duration, Effect, Exit, Layer } from "effect"
import { SqlClient, SqlError } from "effect/sql"

// Readers never create or alter tables: only builds do (CatalogBuild.ts,
// PoliticsBuild.ts, Gather.ts). A preview may read production's database,
// and a reader that made its own schema there would change production's with
// a pull request's code. So a read fails on a database no build has written
// to, and `orUnbuilt` answers `value` instead when one of `tables` is
// missing. Any other failure stays a failure. The check runs only after a
// read fails, so a built database pays nothing for it.
export const orUnbuilt =
  <B>({
    sql,
    tables,
    value,
  }: {
    readonly sql: SqlClient.SqlClient
    readonly tables: ReadonlyArray<string>
    readonly value: B
  }) =>
  <A, E, R>(read: Effect.Effect<A, E, R>): Effect.Effect<A | B, E, R> =>
    read.pipe(
      Effect.catchIf(SqlError.isSqlError, (error) =>
        sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name IN (SELECT value FROM json_each(${JSON.stringify(tables)}))
        `.pipe(
          // A database that cannot list its tables keeps the read's failure.
          Effect.orElseSucceed(() => tables.map((name) => ({ name }))),
          Effect.flatMap((found) =>
            found.length < tables.length ? Effect.succeed(value) : Effect.fail(error),
          ),
        ),
      ),
    )

// A writer of the stage's own DB (Answers.ts, research/Demand.ts) makes its
// tables on its first call, with `tables`, and keeps them made. A failure is
// tried again on the next call.
export const once = <E>(tables: Effect.Effect<void, E, SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    return yield* Effect.cachedWithTTL(
      tables.pipe(Effect.provideService(SqlClient.SqlClient, sql)),
      (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
    )
  })

// The catalog's D1 inside Workers, where the Workflows that build the
// catalog, store the political records and gather the series run: the one
// layer every build writes through. A Worker that reads another stage's
// catalog binds no Workflow (packages/infra/alchemy.run.ts), so a build
// there, such as one left scheduled by a deploy that failed half way, stops
// before it writes anything.
export const database = Layer.unwrap(
  Effect.promise(() => import("cloudflare:workers")).pipe(
    Effect.flatMap(({ env }) =>
      env.CATALOG === undefined || env.GATHER === undefined
        ? Effect.die("This Worker binds no Workflow, so it builds nothing")
        : env.CATALOG_DB === undefined
          ? Effect.die("The Workflow needs the CATALOG_DB binding")
          : Effect.succeed(D1Client.layer({ db: env.CATALOG_DB }).pipe(Layer.orDie)),
    ),
  ),
)
