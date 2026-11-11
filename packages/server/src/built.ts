import { Effect } from "effect"
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
