import { env } from "cloudflare:workers"
import { Effect } from "effect"

// A preview without the own-catalog label binds production's database as
// CATALOG_DB (packages/infra/alchemy.run.ts). Here CATALOG_DB is a database of
// its own, so a test sees everything a request does to it.
const db = env.CATALOG_DB

if (db === undefined) throw new Error("vitest.config.ts must bind a D1 database as CATALOG_DB")

// Every table's and index's definition in CATALOG_DB. D1's own tables and
// SQLite's are left out: neither is ours to read.
export const schema = Effect.promise(() =>
  db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
    )
    .all<{ type: string; name: string; sql: string | null }>(),
).pipe(Effect.map(({ results }) => results))

// The schema with each table's row count: what a write would change.
export const snapshot = Effect.gen(function* () {
  const tables = yield* schema

  return yield* Effect.forEach(tables, ({ type, name, sql }) =>
    type === "table"
      ? Effect.promise(() =>
          db.prepare(`SELECT count(*) AS count FROM "${name}"`).first("count"),
        ).pipe(Effect.map((count) => ({ name, sql, count })))
      : Effect.succeed({ name, sql, count: null }),
  )
})
