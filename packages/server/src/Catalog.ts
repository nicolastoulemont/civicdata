import { CatalogEntry, CatalogUnavailable, type IndicatorId, Source } from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
import { Array as Arr, Context, Effect, Layer, Option, Record, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

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
  ) => Effect.Effect<ReadonlyMap<IndicatorId, Labelled>>
}

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
// generation of each source that searches read; `catalog_fingerprint` holds
// a fingerprint of what each generation stores, which tells a build whether a
// listing matches the published generation; `catalog_direction` holds which
// way each indicator's values are better. A build writes a new generation
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
        },
        // Database and row-decoding failures are defects: nothing a caller can fix.
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

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
        execute: (ids) => sql`
          SELECT label.codelist, label.code, label.label
          FROM catalog_outline AS outline, json_each(outline.dimensions) AS dimension,
            json_each(dimension.value, '$.codes') AS code
          JOIN catalog_label AS label ON label.source = outline.source
            AND label.codelist = dimension.value ->> 'codelist' AND label.code = code.value
          WHERE outline.indicator IN (SELECT value FROM json_each(${ids}))
            AND label.label IS NOT NULL
        `,
      })

      const outlines = Effect.fn("Catalog.outlines")(
        function* (indicators: ReadonlyArray<IndicatorId>) {
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
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

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
