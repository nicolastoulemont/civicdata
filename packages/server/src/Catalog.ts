import { CatalogEntry, CatalogUnavailable, type SourceUnavailable } from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
import { Array as Arr, Clock, Context, Effect, Layer, Option, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { WorldBank } from "./WorldBank.ts"

interface Interface {
  readonly search: (
    text: string,
  ) => Effect.Effect<ReadonlyArray<CatalogEntry>, SourceUnavailable | CatalogUnavailable>
}

const source = "World Bank"

// The World Bank revises its indicator list a few times a year.
const maxAge = 7 * 24 * 60 * 60 * 1000

// Each insert binds one JSON array of entries, unpacked by SQLite's json_each,
// so a load is a handful of round trips instead of one per 20 rows (D1 binds
// at most 100 parameters per statement). 250 entries is about 250 KB, well
// under D1's 2 MB limit for one bound value.
const rowsPerInsert = 250

const EntriesJson = Schema.fromJsonString(Schema.Array(CatalogEntry))

// "youth unemploy" → `"youth"* "unemploy"*`: every word must match, as a
// prefix, and quoting keeps FTS5 operators in user text inert.
const toMatch = (text: string) =>
  text
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.map((word) => `"${word}"*`)
    .join(" ")

const Refresh = Schema.Struct({ generation: Schema.Int, refreshed_at: Schema.Int })

// Indicator search over the source's catalog, stored in SQLite full-text
// search (FTS5). The catalog loads itself when empty or older than `maxAge`.
// A load writes a new generation and drops the previous one only after the
// new one is complete, so a search never sees a half-loaded catalog.
export class Catalog extends Context.Service<Catalog, Interface>()("@civicdata/server/Catalog") {
  static readonly layer = Layer.effect(
    Catalog,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const worldBank = yield* WorldBank

      yield* sql`
        CREATE TABLE IF NOT EXISTS catalog_refresh (
          source TEXT PRIMARY KEY,
          generation INTEGER NOT NULL,
          refreshed_at INTEGER NOT NULL
        )
      `
      yield* sql`
        CREATE VIRTUAL TABLE IF NOT EXISTS catalog USING fts5(
          source UNINDEXED, generation UNINDEXED, indicator, name, definition,
          tokenize = 'unicode61 remove_diacritics 2'
        )
      `

      const lastRefresh = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Refresh,
        execute: (name) =>
          sql`SELECT generation, refreshed_at FROM catalog_refresh WHERE source = ${name}`,
      })

      const matches = SqlSchema.findAll({
        Request: Schema.Struct({
          match: Schema.String,
          code: Schema.String,
          generation: Schema.Int,
        }),
        Result: CatalogEntry,
        // Codes the user typed the start of come first: "SP.POP" also matches
        // "Specialist ... population" by word prefixes. Then bm25, whose
        // weights follow the column order: a hit in the name counts ten times
        // one in the definition, a hit in the indicator code five times.
        execute: ({ match, code, generation }) => sql`
          SELECT indicator, name, definition FROM catalog
          WHERE catalog MATCH ${match} AND source = ${source} AND generation = ${generation}
          ORDER BY substr(lower(indicator), 1, length(${code})) = ${code} DESC,
            bm25(catalog, 0.0, 0.0, 5.0, 10.0, 1.0)
          LIMIT 20
        `,
      })

      const load = Effect.fn("Catalog.load")(function* (generation: number, now: number) {
        const entries = yield* worldBank.indicators

        for (const chunk of Arr.chunksOf(entries, rowsPerInsert)) {
          const rows = yield* Schema.encodeEffect(EntriesJson)(chunk)

          yield* sql`
            INSERT INTO catalog (source, generation, indicator, name, definition)
            SELECT ${source}, ${generation}, json_extract(value, '$.indicator'),
              json_extract(value, '$.name'), json_extract(value, '$.definition')
            FROM json_each(${rows})
          `
        }

        yield* sql`
          INSERT INTO catalog_refresh (source, generation, refreshed_at)
          VALUES (${source}, ${generation}, ${now})
          ON CONFLICT (source) DO UPDATE
          SET generation = excluded.generation, refreshed_at = excluded.refreshed_at
        `
        yield* sql`DELETE FROM catalog WHERE source = ${source} AND generation != ${generation}`

        return generation
      })

      // The generation to search, loading or refreshing the catalog first if
      // needed. A failed refresh keeps the stale catalog; an empty catalog
      // with the source down fails with SourceUnavailable.
      const generation = Effect.gen(function* () {
        const last = yield* lastRefresh(source)
        const now = yield* Clock.currentTimeMillis

        if (Option.isNone(last)) return yield* load(1, now)

        if (now - last.value.refreshed_at < maxAge) return last.value.generation

        return yield* load(last.value.generation + 1, now).pipe(
          Effect.catchTag("SourceUnavailable", (error) =>
            Effect.logWarning("Serving a stale catalog", error).pipe(
              Effect.as(last.value.generation),
            ),
          ),
        )
      })

      const search = Effect.fn("Catalog.search")(
        function* (text: string) {
          const match = toMatch(text)

          if (match === undefined) return []

          return yield* matches({
            match,
            code: text.trim().toLowerCase(),
            generation: yield* generation,
          })
        },
        // Database and row-decoding failures are defects: nothing a caller can fix.
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      return Catalog.of({ search })
    }).pipe(Effect.orDie),
  )

  static readonly unavailable = Layer.succeed(
    Catalog,
    Catalog.of({ search: () => Effect.fail(new CatalogUnavailable()) }),
  )

  // D1 inside Workers (deployed, or under `alchemy dev`). Plain `pnpm dev`
  // runs in Node, where `cloudflare:workers` does not exist.
  static readonly live = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) =>
        env.DB === undefined
          ? Catalog.unavailable
          : Catalog.layer.pipe(Layer.provide(D1Client.layer({ db: env.DB }).pipe(Layer.orDie))),
      ),
      Effect.orElseSucceed(() => Catalog.unavailable),
    ),
  )
}
