import { CatalogEntry, CatalogUnavailable, type IndicatorId, Source } from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
import { Array as Arr, Context, Effect, Layer, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { Vectors } from "./Vectors.ts"

interface Interface {
  // The entries that best match the text, best first, of one source when
  // `source` names it.
  readonly search: (
    text: string,
    options?: { readonly source?: Source | undefined },
  ) => Effect.Effect<ReadonlyArray<CatalogEntry>, CatalogUnavailable>
}

const limit = 20

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

// The catalog's tables. `catalog` holds every generation of every source's
// entries in SQLite full-text search (FTS5); `catalog_current` names the
// generation of each source that searches read. A build writes a new
// generation and publishes it once complete (see CatalogBuild.ts).
export const tables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS catalog USING fts5(
      source UNINDEXED, generation UNINDEXED, indicator, name, definition,
      tokenize = 'unicode61 remove_diacritics 2'
    )
  `
  yield* sql`
    CREATE TABLE IF NOT EXISTS catalog_current (
      source TEXT PRIMARY KEY,
      generation INTEGER NOT NULL
    )
  `
  // Left by the catalog that loaded and embedded itself during searches.
  yield* sql`DROP TABLE IF EXISTS catalog_refresh`
  yield* sql`DROP TABLE IF EXISTS catalog_embedded`
})

// Indicator search over the published catalog of every source, merged with
// the indicators closest in meaning from Vectors. Every result comes from a
// published generation: a neighbor no longer in the catalog is dropped.
export class Catalog extends Context.Service<Catalog, Interface>()("@civicdata/server/Catalog") {
  static readonly layer = Layer.effect(
    Catalog,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const vectors = yield* Vectors

      yield* tables

      // The sources with a published generation.
      const published = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({ source: Schema.String }),
        execute: () => sql`SELECT source FROM catalog_current`,
      })

      const matches = SqlSchema.findAll({
        Request: Schema.Struct({
          match: Schema.String,
          code: Schema.String,
          source: Schema.NullOr(Source),
        }),
        Result: CatalogEntry,
        // Codes the user typed the start of come first: "SP.POP" also matches
        // "Specialist ... population" by word prefixes. Then bm25, whose
        // weights follow the column order: a hit in the name counts ten times
        // one in the definition, a hit in the indicator code five times.
        execute: ({ match, code, source }) => sql`
          SELECT catalog.indicator, catalog.name, catalog.definition FROM catalog
          JOIN catalog_current AS current
            ON current.source = catalog.source AND current.generation = catalog.generation
          WHERE catalog MATCH ${match} AND (${source} IS NULL OR catalog.source = ${source})
          ORDER BY substr(lower(catalog.indicator), 1, length(${code})) = ${code} DESC,
            bm25(catalog, 0.0, 0.0, 5.0, 10.0, 1.0)
          LIMIT ${limit}
        `,
      })

      const listed = SqlSchema.findAll({
        Request: Schema.Struct({
          indicators: Schema.Array(Schema.String),
          match: Schema.String,
          source: Schema.NullOr(Source),
        }),
        Result: CatalogEntry,
        execute: ({ indicators, match, source }) =>
          Schema.encodeEffect(IdsJson)(indicators).pipe(
            Effect.flatMap(
              (ids) => sql`
                SELECT catalog.indicator, catalog.name, catalog.definition FROM catalog
                JOIN catalog_current AS current
                  ON current.source = catalog.source AND current.generation = catalog.generation
                WHERE catalog MATCH ${match}
                  AND (${source} IS NULL OR catalog.source = ${source})
                  AND catalog.indicator IN (SELECT value FROM json_each(${ids}))
              `,
            ),
          ),
      })

      // The published entries closest in meaning to the text, closest first.
      // Without Vectors, keyword search still answers.
      const byMeaning = Effect.fn("Catalog.byMeaning")(
        function* (text: string, source: Source | null) {
          const indicators = yield* vectors.nearest(text)

          if (!Arr.isReadonlyArrayNonEmpty(indicators)) return []

          const found = yield* listed({ indicators, match: toCodes(indicators), source })
          const entries = new Map(found.map((entry) => [entry.indicator, entry]))

          // A neighbor missing from the catalog left it.
          return indicators.flatMap((indicator) => entries.get(indicator) ?? [])
        },
        Effect.catchTag("VectorsUnavailable", (error) =>
          Effect.logWarning("Searching by meaning failed", error.cause).pipe(Effect.as([])),
        ),
      )

      const search = Effect.fn("Catalog.search")(
        function* (text: string, options?: { readonly source?: Source | undefined }) {
          const match = toMatch(text)
          const source = options?.source ?? null

          if (match === undefined) return []

          // Before the first build publishes a source, there is nothing to search.
          if (!Arr.isReadonlyArrayNonEmpty(yield* published())) {
            return yield* new CatalogUnavailable()
          }

          const code = text.trim().toLowerCase()

          const [byWords, nearest] = yield* Effect.all(
            [matches({ match, code, source }), byMeaning(text, source)],
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
