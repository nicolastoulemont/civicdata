import { D1Client } from "@effect/sql-d1"
import { CatalogEntry, CatalogUnavailable, type IndicatorId, Source } from "@openfacts/domain"
import { Array as Arr, Context, Effect, Layer, Option, Record, Schedule, Schema } from "effect"
import { SqlClient, SqlError, SqlSchema } from "effect/sql"

import { orUnbuilt } from "./built.ts"
import { Dimension, Outline } from "./Outlines.ts"
import { Vectors } from "./Vectors.ts"

// A dataset's outline as search hands it over: each code of its dimensions
// with its label, or the code itself while it has none.
export interface Labelled extends Omit<Outline, "dimensions"> {
  readonly dimensions: ReadonlyArray<{
    readonly id: Dimension["id"]
    readonly codes: Arr.NonEmptyReadonlyArray<{ readonly code: string; readonly label: string }>
  }>
}

interface Interface {
  // The entries that best match the text, best first, of one source when
  // `source` names it.
  readonly search: (
    text: string,
    options?: { readonly source?: Source | undefined },
  ) => Effect.Effect<ReadonlyArray<CatalogEntry>, CatalogUnavailable>
  // The stored outline of each Eurostat dataset and OECD dataflow among the
  // indicators. One the catalog has no outline for is missing: a World Bank
  // indicator, an OECD dataflow without a constraint, or any before a build
  // stored outlines.
  readonly outlines: (
    indicators: ReadonlyArray<IndicatorId>,
  ) => Effect.Effect<ReadonlyMap<IndicatorId, Labelled>, CatalogUnavailable>
}

// A read of the catalog. D1 refuses reads for a few seconds once the
// database is overloaded, so a failed read is tried twice more, a second and
// then two apart, before the catalog is unavailable. Rows that fail to decode
// are a defect: nothing a caller can fix.
const read = <A, R>(
  effect: Effect.Effect<A, CatalogUnavailable | SqlError.SqlError | Schema.SchemaError, R>,
): Effect.Effect<A, CatalogUnavailable, R> =>
  effect.pipe(
    Effect.retry({
      while: SqlError.isSqlError,
      schedule: Schedule.exponential("1 second"),
      times: 2,
    }),
    Effect.catchTag("SqlError", (error) =>
      Effect.logError("Catalog read failed", error).pipe(
        Effect.andThen(Effect.fail(new CatalogUnavailable())),
      ),
    ),
    Effect.catchTag("SchemaError", Effect.die),
  )

const limit = 20

const IdsJson = Schema.fromJsonString(Schema.Array(Schema.String))

// An outline as catalog_outline stores it.
const Stored = Schema.Struct({
  indicator: Outline.fields.indicator,
  annual: Schema.Int,
  countries: Schema.fromJsonString(Outline.fields.countries),
  first: Schema.NullOr(Schema.Int),
  last: Schema.NullOr(Schema.Int),
  dimensions: Schema.fromJsonString(Schema.Array(Dimension)),
})

const Label = Schema.Struct({ codelist: Schema.String, code: Schema.String, label: Schema.String })

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

// "youth unemploy" → `"youth"* "unemploy"*`: every word must match, as a
// prefix, and quoting keeps FTS5 operators in user text inert.
const toMatch = (text: string) => {
  const found = words(text)

  return found.length === 0 ? undefined : found.map((word) => `"${word}"*`).join(" ")
}

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
// generation of each source that searches read; `catalog_fingerprint` holds
// a fingerprint of what each generation stores, which tells a build whether a
// listing matches the published generation; `catalog_indicator` finds an
// entry's row by its indicator; `catalog_direction` holds which way each
// indicator's values are better. A build writes a new generation
// and publishes it once complete (see CatalogBuild.ts). Only builds run this:
// readers never create tables (built.ts).
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
  // The rowid of each entry's row in `catalog`, by indicator. FTS5 indexes
  // the words of a code, never the whole code, so a lookup through it reads
  // the long lists of rows holding words many codes share ("oecd", "dsd",
  // "1"). A build fills a generation's rows when it publishes it.
  yield* sql`
    CREATE TABLE IF NOT EXISTS catalog_indicator (
      indicator TEXT NOT NULL,
      source TEXT NOT NULL,
      generation INTEGER NOT NULL,
      entry INTEGER NOT NULL,
      PRIMARY KEY (indicator, source, generation)
    ) WITHOUT ROWID
  `
  // A catalog an earlier version built has no rows here until a source
  // changes, so they come from what it holds. A catalog built since is
  // empty only before its first publish, with nothing to read.
  const indexed = yield* sql`SELECT 1 FROM catalog_indicator LIMIT 1`

  if (indexed.length === 0) {
    yield* sql`
      INSERT INTO catalog_indicator (indicator, source, generation, entry)
      SELECT indicator, source, generation, rowid FROM catalog WHERE true
      ON CONFLICT DO NOTHING
    `
  }

  // A table of its own, rather than a column of catalog_current, so a stage
  // whose tables an earlier version made gets it too.
  yield* sql`
    CREATE TABLE IF NOT EXISTS catalog_fingerprint (
      source TEXT NOT NULL,
      generation INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      PRIMARY KEY (source, generation)
    )
  `
  // The direction the catalog Workflow's model gave each indicator, with the
  // name and definition it read and the model that answered: a build asks
  // again only when one of them changes. Kept across generations, so an
  // unchanged entry keeps its direction. CatalogBuild.ts adds `model` to a
  // table an earlier version made.
  yield* sql`
    CREATE TABLE IF NOT EXISTS catalog_direction (
      indicator TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      definition TEXT NOT NULL,
      direction TEXT NOT NULL,
      model TEXT NOT NULL
    )
  `
  // The outline of each Eurostat dataset and OECD dataflow (Outlines.ts): its
  // dimensions with their codes and codelists, whether it has annual values,
  // our countries it covers and its first and last year, kept apart from the
  // generations since the source's listing does not hold them. `fingerprint`
  // tells a build whether an outline changed; `text` holds the labels search
  // embeds with the dataset's name.
  yield* sql`
    CREATE TABLE IF NOT EXISTS catalog_outline (
      indicator TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      annual INTEGER NOT NULL,
      countries TEXT NOT NULL,
      first INTEGER,
      last INTEGER,
      dimensions TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT ''
    )
  `
  // A build reads and prunes one source's outlines by this index, and reads
  // their fingerprints from it alone, never touching `dimensions`.
  yield* sql`
    CREATE INDEX IF NOT EXISTS catalog_outline_source
    ON catalog_outline (source, indicator, fingerprint)
  `
  // A streamed refresh stages changed chunks before touching published outlines.
  yield* sql`CREATE TABLE IF NOT EXISTS catalog_outline_stage (source TEXT NOT NULL, rows TEXT NOT NULL)`
  // The label of each code an outline uses, by its source's codelist. A code
  // gets a row when an outline first uses it, with no label until a build or
  // the first fill reads its codelist.
  yield* sql`
    CREATE TABLE IF NOT EXISTS catalog_label (
      source TEXT NOT NULL,
      codelist TEXT NOT NULL,
      code TEXT NOT NULL,
      label TEXT,
      PRIMARY KEY (source, codelist, code)
    ) WITHOUT ROWID
  `
  // The codes with no label yet, so a build finds the codelists to label
  // without reading every label a source has.
  yield* sql`
    CREATE INDEX IF NOT EXISTS catalog_unlabelled
    ON catalog_label (source, codelist) WHERE label IS NULL
  `
  // Left by the catalog that loaded and embedded itself during searches.
  yield* sql`DROP TABLE IF EXISTS catalog_refresh`
  yield* sql`DROP TABLE IF EXISTS catalog_embedded`
})

// Indicator search over the published catalog of every source, merged with
// the indicators closest in meaning from Vectors. Every result comes from a
// published generation: a neighbor no longer in the catalog is dropped.
export class Catalog extends Context.Service<Catalog, Interface>()("@openfacts/server/Catalog") {
  static readonly layer = Layer.effect(
    Catalog,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const vectors = yield* Vectors

      // The sources with a published generation.
      const published = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({ source: Source }),
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

      // The published entries of the indicators: each code's row in
      // catalog_indicator, then its catalog row by rowid. CROSS JOIN fixes
      // that order, so a plan never starts from the full-text table.
      const listed = SqlSchema.findAll({
        Request: Schema.Struct({ ids: Schema.String, source: Schema.NullOr(Source) }),
        Result: CatalogEntry,
        execute: ({ ids, source }) => sql`
          SELECT catalog.indicator, catalog.name, catalog.definition
          FROM json_each(${ids}) AS id
          CROSS JOIN catalog_indicator AS indexed ON indexed.indicator = id.value
          CROSS JOIN catalog_current AS current
            ON current.source = indexed.source AND current.generation = indexed.generation
          CROSS JOIN catalog ON catalog.rowid = indexed.entry
          WHERE ${source} IS NULL OR indexed.source = ${source}
        `,
      })

      // The published entries closest in meaning to the text, closest first.
      // Without Vectors, keyword search still answers.
      const byMeaning = Effect.fn("Catalog.byMeaning")(
        function* (text: string, source: Source | null) {
          const indicators = yield* vectors.nearest(text)

          if (!Arr.isReadonlyArrayNonEmpty(indicators)) return []

          const ids = yield* Schema.encodeEffect(IdsJson)(indicators)

          // A stage whose last build predates catalog_indicator searches
          // by words alone until its next build.
          const found = yield* listed({ ids, source }).pipe(
            orUnbuilt({ sql, tables: ["catalog_indicator"], value: [] }),
          )

          const entries = new Map(found.map((entry) => [entry.indicator, entry]))

          // A neighbor missing from the catalog left it.
          return indicators.flatMap((indicator) => entries.get(indicator) ?? [])
        },
        Effect.catchTag("VectorsUnavailable", (error) =>
          Effect.logWarning("Searching by meaning failed", error.cause).pipe(Effect.as([])),
        ),
      )

      const search = Effect.fn("Catalog.search")(function* (
        text: string,
        options?: { readonly source?: Source | undefined },
      ) {
        const match = toMatch(text)
        const source = options?.source ?? null

        if (match === undefined) return []

        // Before a build publishes the source searched, or any source for
        // a search of all, there is nothing to search: an unpublished
        // source would answer that it lists no such indicator. A database
        // no build has written to has published nothing.
        const sources = yield* published().pipe(
          orUnbuilt({ sql, tables: ["catalog", "catalog_current"], value: [] }),
        )

        if (
          source === null
            ? !Arr.isReadonlyArrayNonEmpty(sources)
            : !sources.some((found) => found.source === source)
        ) {
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
      }, read)

      const stored = SqlSchema.findAll({
        Request: Schema.String,
        Result: Stored,
        execute: (ids) => sql`
          SELECT indicator, annual, countries, first, last, dimensions FROM catalog_outline
          WHERE indicator IN (SELECT value FROM json_each(${ids}))
        `,
      })

      const labels = SqlSchema.findAll({
        Request: Schema.String,
        Result: Label,
        // CROSS JOIN keeps this join order, which SQLite would otherwise
        // change: each code is read out of its outline before its label is
        // looked up by the label's whole key. Looking labels up first, by
        // source alone, read every label of the publisher for each outline:
        // 35 million rows for five OECD outlines in production.
        execute: (ids) => sql`
          SELECT label.codelist, label.code, label.label
          FROM catalog_outline AS outline
          CROSS JOIN json_each(outline.dimensions) AS dimension
          CROSS JOIN json_each(dimension.value, '$.codes') AS code
          CROSS JOIN catalog_label AS label
          WHERE outline.indicator IN (SELECT value FROM json_each(${ids}))
            AND label.source = outline.source
            AND label.codelist = dimension.value ->> 'codelist'
            AND label.code = code.value
            AND label.label IS NOT NULL
        `,
      })

      const outlines = Effect.fn("Catalog.outlines")(function* (
        indicators: ReadonlyArray<IndicatorId>,
      ) {
        const ids = yield* Schema.encodeEffect(IdsJson)(indicators)

        const [rows, named] = yield* Effect.all([stored(ids), labels(ids)], {
          concurrency: "unbounded",
        }).pipe(
          orUnbuilt({
            sql,
            tables: ["catalog_outline", "catalog_label"],
            value: [[], []] as const,
          }),
        )

        const label = new Map(
          named.map(({ codelist, code, label: text }) => [`${codelist} ${code}`, text]),
        )

        return new Map(
          rows.map(({ indicator, annual, countries, first, last, dimensions }) => [
            indicator,
            {
              indicator,
              annual: annual === -1 ? null : annual === 1,
              countries,
              years: first === null || last === null ? null : { first, last },
              dimensions: dimensions.map(({ id, codelist, codes, labels: names }) => ({
                id,
                codes: Arr.map(codes, (code) => ({
                  code,
                  label:
                    Option.getOrUndefined(Record.get(names ?? {}, code)) ??
                    (codelist === null ? undefined : label.get(`${codelist} ${code}`)) ??
                    code,
                })),
              })),
            } satisfies Labelled,
          ]),
        )
      }, read)

      return Catalog.of({ search, outlines })
    }).pipe(Effect.orDie),
  )

  static readonly unavailable = Layer.succeed(
    Catalog,
    Catalog.of({
      search: () => Effect.fail(new CatalogUnavailable()),
      outlines: () => Effect.succeed(new Map()),
    }),
  )

  // The catalog's D1 inside Workers (deployed, or under `alchemy dev`). Plain
  // `pnpm dev` runs in Node, where `cloudflare:workers` does not exist.
  static readonly live = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) =>
        env.CATALOG_DB === undefined
          ? Catalog.unavailable
          : Catalog.layer.pipe(
              Layer.provide(D1Client.layer({ db: env.CATALOG_DB }).pipe(Layer.orDie)),
              Layer.provide(Vectors.live),
            ),
      ),
      Effect.orElseSucceed(() => Catalog.unavailable),
    ),
  )
}
