import {
  CatalogEntry,
  CatalogUnavailable,
  type IndicatorId,
  type SourceUnavailable,
} from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
import { Array as Arr, Clock, Context, Effect, Layer, Option, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { Vectors } from "./Vectors.ts"
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

// Entries embedded per search until a generation is all in Vectorize.
// Embedding the whole catalog at once would take far more than the 10 ms of
// CPU a Workers Free request gets: decoding 384 numbers per entry dominates.
const embedPerSearch = 50

const limit = 20

const EntriesJson = Schema.fromJsonString(Schema.Array(CatalogEntry))

const IdsJson = Schema.fromJsonString(Schema.Array(Schema.String))

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

// "youth unemploy" → `"youth"* "unemploy"*`: every word must match, as a
// prefix, and quoting keeps FTS5 operators in user text inert.
const toMatch = (text: string) => {
  const found = words(text)

  return found.length === 0 ? undefined : found.map((word) => `"${word}"*`).join(" ")
}

// ["NY.GDP.PCAP.CD", ...] → `indicator : ("ny gdp pcap cd" OR ...)`: each code
// as a phrase, so FTS5 finds the rows through its index instead of scanning
// the table. The phrase also matches longer codes, which the exact
// comparison in the query then drops.
const toCodes = (indicators: ReadonlyArray<IndicatorId>) =>
  `indicator : (${indicators.map((indicator) => `"${words(indicator).join(" ")}"`).join(" OR ")})`

// Reciprocal rank fusion: an entry scores 1 / (60 + rank) in each ranking it
// appears in, so one found by words and by meaning rises above one found by
// either alone. 60 is the constant from Cormack et al. (2009).
const fuse = (rankings: ReadonlyArray<ReadonlyArray<CatalogEntry>>) => {
  const scores = new Map<IndicatorId, { entry: CatalogEntry; score: number }>()

  for (const ranking of rankings) {
    for (const [rank, entry] of ranking.entries()) {
      const score = scores.get(entry.indicator)?.score ?? 0

      scores.set(entry.indicator, { entry, score: score + 1 / (61 + rank) })
    }
  }

  return [...scores.values()].toSorted((a, b) => b.score - a.score).map(({ entry }) => entry)
}

const Refresh = Schema.Struct({ generation: Schema.Int, refreshed_at: Schema.Int })

const Embedded = Schema.Struct({ generation: Schema.Int, through: Schema.Int })

const Pending = Schema.Struct({ rowid: Schema.Int, ...CatalogEntry.fields })

// Indicator search over the source's catalog, stored in SQLite full-text
// search (FTS5), merged with the indicators closest in meaning from Vectors.
// The catalog loads itself when empty or older than `maxAge`. A load writes a
// new generation and drops the previous one only after the new one is
// complete, so a search never sees a half-loaded catalog. Each search then
// embeds the next `embedPerSearch` entries of the generation, until all are
// in Vectors. Every result comes from the current generation: a neighbor no
// longer in the catalog is dropped.
export class Catalog extends Context.Service<Catalog, Interface>()("@civicdata/server/Catalog") {
  static readonly layer = Layer.effect(
    Catalog,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const worldBank = yield* WorldBank
      const vectors = yield* Vectors

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
      // `through` is the rowid of the last entry of `generation` in Vectors.
      yield* sql`
        CREATE TABLE IF NOT EXISTS catalog_embedded (
          source TEXT PRIMARY KEY,
          generation INTEGER NOT NULL,
          through INTEGER NOT NULL
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
          LIMIT ${limit}
        `,
      })

      const listed = SqlSchema.findAll({
        Request: Schema.Struct({
          indicators: Schema.Array(Schema.String),
          match: Schema.String,
          generation: Schema.Int,
        }),
        Result: CatalogEntry,
        execute: ({ indicators, match, generation }) =>
          Schema.encodeEffect(IdsJson)(indicators).pipe(
            Effect.flatMap(
              (ids) => sql`
                SELECT indicator, name, definition FROM catalog
                WHERE catalog MATCH ${match} AND source = ${source} AND generation = ${generation}
                  AND indicator IN (SELECT value FROM json_each(${ids}))
              `,
            ),
          ),
      })

      const lastEmbedded = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Embedded,
        execute: (name) =>
          sql`SELECT generation, through FROM catalog_embedded WHERE source = ${name}`,
      })

      const pending = SqlSchema.findAll({
        Request: Schema.Struct({ generation: Schema.Int, after: Schema.Int }),
        Result: Pending,
        execute: ({ generation, after }) => sql`
          SELECT rowid, indicator, name, definition FROM catalog
          WHERE rowid > ${after} AND source = ${source} AND generation = ${generation}
          ORDER BY rowid
          LIMIT ${embedPerSearch}
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

      // Stores the generation's next entries in Vectors, if any are left. A
      // failure leaves them for the next search.
      const embedNext = Effect.fn("Catalog.embedNext")(
        function* (current: number) {
          const after = Option.match(yield* lastEmbedded(source), {
            onNone: () => 0,
            onSome: (last) => (last.generation === current ? last.through : 0),
          })

          const batch = yield* pending({ generation: current, after })

          if (!Arr.isReadonlyArrayNonEmpty(batch)) return

          yield* vectors.put(batch)
          yield* sql`
            INSERT INTO catalog_embedded (source, generation, through)
            VALUES (${source}, ${current}, ${Arr.lastNonEmpty(batch).rowid})
            ON CONFLICT (source) DO UPDATE
            SET generation = excluded.generation, through = excluded.through
          `
        },
        Effect.catchTag("VectorsUnavailable", (error) =>
          Effect.logWarning("Embedding the catalog failed", error.cause),
        ),
      )

      // The generation's entries closest in meaning to the text, closest
      // first. Without Vectors, keyword search still answers.
      const byMeaning = Effect.fn("Catalog.byMeaning")(
        function* (text: string, current: number) {
          const indicators = yield* vectors.nearest(text)

          if (!Arr.isReadonlyArrayNonEmpty(indicators)) return []

          const found = yield* listed({
            indicators,
            match: toCodes(indicators),
            generation: current,
          })

          const entries = new Map(found.map((entry) => [entry.indicator, entry]))

          // A neighbor missing from the generation left the catalog.
          return indicators.flatMap((indicator) => entries.get(indicator) ?? [])
        },
        Effect.catchTag("VectorsUnavailable", (error) =>
          Effect.logWarning("Searching by meaning failed", error.cause).pipe(Effect.as([])),
        ),
      )

      const search = Effect.fn("Catalog.search")(
        function* (text: string) {
          const match = toMatch(text)

          if (match === undefined) return []

          const code = text.trim().toLowerCase()
          const current = yield* generation

          const [byWords, nearest] = yield* Effect.all(
            [
              matches({ match, code, generation: current }),
              byMeaning(text, current),
              embedNext(current),
            ],
            { concurrency: "unbounded" },
          )

          const startsWithCode = (entry: CatalogEntry) =>
            entry.indicator.toLowerCase().startsWith(code)

          // Fusion keeps the rule `matches` applies: typed codes come first.
          return fuse([byWords, nearest])
            .toSorted((a, b) => Number(startsWithCode(b)) - Number(startsWithCode(a)))
            .slice(0, limit)
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
          : Catalog.layer.pipe(
              Layer.provide(D1Client.layer({ db: env.DB }).pipe(Layer.orDie)),
              Layer.provide(Vectors.live),
            ),
      ),
      Effect.orElseSucceed(() => Catalog.unavailable),
    ),
  )
}
