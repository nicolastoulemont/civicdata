import { Country, IndicatorId, type Source } from "@repo/domain"
import { Array as Arr, Context, Effect, Layer, Option, Record, Schema, Stream } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { type Codelist, Dimension, Outline, searchable } from "../series/Outline.ts"
import type { SdmxSource } from "../sources/sdmx/SdmxSource.ts"
import { Structures } from "../sources/sdmx/Structures.ts"
import { fingerprint } from "../utils/fingerprint.ts"

// How much of an outline's labels search embeds with the dataset's name: the
// embedding model reads about 512 tokens, and a name and definition need
// some of them.
const labelsPerDimension = 20
const textLength = 1500

// The labels search embeds with a dataset's name, so "youth unemployment"
// finds a dataset with an age dimension. Dimensions with fewer codes come
// first: a single unit or measure says most about what a dataset holds. A
// code without a label adds nothing.
const embedded = (
  outline: Pick<Outline, "dimensions">,
  label: (codelist: Codelist, code: string) => string | undefined,
) =>
  outline.dimensions
    .toSorted((a, b) => a.codes.length - b.codes.length)
    .flatMap(({ codelist, codes, labels }) =>
      codes
        .flatMap(
          (code) =>
            Option.getOrUndefined(Record.get(labels ?? {}, code)) ??
            (codelist === null ? undefined : label(codelist, code)) ??
            [],
        )
        .slice(0, labelsPerDimension),
    )
    .filter((text, at, all) => all.indexOf(text) === at)
    .join("; ")
    .slice(0, textLength)

// An outline as its row stores it, with the fingerprint of what it holds, and
// whether search shows it: only then do its codes need labels.
const Row = Schema.Struct({
  searchable: Schema.Boolean,
  indicator: IndicatorId,
  annual: Schema.Int,
  countries: Schema.NullOr(Schema.Array(Country)),
  first: Schema.NullOr(Schema.Int),
  last: Schema.NullOr(Schema.Int),
  dimensions: Schema.Array(Dimension),
  fingerprint: Schema.String,
})

const RowJson = Schema.fromJsonString(Row)

const OutlineJson = Schema.fromJsonString(Outline)

const IdsJson = Schema.fromJsonString(Schema.Array(IndicatorId))

const LabelsJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String))

const TextsJson = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ indicator: IndicatorId, text: Schema.String })),
)

// A stored outline's dimensions and the text it embeds.
const Described = Schema.Struct({
  indicator: IndicatorId,
  dimensions: Schema.fromJsonString(Schema.Array(Dimension)),
  text: Schema.String,
})

// Outlines per read or write. An outline's row holds every code of its
// dimensions, a few kilobytes for most and up to about 200 KB, so a write
// binds a JSON array of at most about 500 KB, well under D1's 2 MB for one
// bound value.
const perRead = 500
const perWrite = 100
const bytesPerWrite = 500_000

// Groups encoded rows into arrays of at most `bytesPerWrite` characters.
const bySize = (rows: ReadonlyArray<string>) => {
  const groups: Array<Array<string>> = []
  let size = 0

  for (const row of rows) {
    const last = groups.at(-1)

    if (last === undefined || size + row.length > bytesPerWrite) {
      groups.push([row])
      size = row.length
    } else {
      last.push(row)
      size += row.length
    }
  }

  return groups.map((group) => `[${group.join(",")}]`)
}

interface Interface {
  // Stores the outlines of the source's datasets the stream gives, writing
  // only those that changed, gives a row in catalog_label to each code of an
  // outline that search shows, and deletes the source's outlines the stream
  // no longer gives. Answers how many it wrote. A stream that gives no
  // outline changes nothing: the file was empty, not every dataset gone.
  readonly write: <E>(
    source: Source,
    outlines: Stream.Stream<Outline, E>,
  ) => Effect.Effect<number, E>
  // The source's codelists after `after`, in order, with a code in use that
  // has no label: at most `limit`.
  readonly unlabelled: (
    source: Source,
    options: { readonly after: string; readonly limit: number },
  ) => Effect.Effect<ReadonlyArray<Codelist>>
  // Labels the codes of the codelist that have no label, from `labels`, or
  // with the code itself when the source gave it no label, so no build asks
  // for the codelist again. Answers how many codes it labelled.
  readonly label: (
    source: Source,
    {
      codelist,
      labels,
    }: { readonly codelist: Codelist; readonly labels: ReadonlyMap<string, string> },
  ) => Effect.Effect<number>
  // Writes the text each of the source's outlines embeds, from its labels,
  // where it changed. Answers how many it wrote.
  readonly describe: (source: Source) => Effect.Effect<number>
}

// The catalog's outlines and labels in D1. Builds write them: the catalog
// Workflow every week, and scripts/outlines.ts on a stage's first fill. Only
// builds create the tables (Catalog.ts).
export class Outlines extends Context.Service<Outlines, Interface>()("@repo/server/Outlines") {
  static readonly layer = Layer.effect(
    Outlines,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const prints = SqlSchema.findAll({
        Request: Schema.String,
        Result: Schema.Struct({ indicator: IndicatorId, fingerprint: Schema.String }),
        execute: (source) =>
          sql`SELECT indicator, fingerprint FROM catalog_outline WHERE source = ${source}`,
      })

      const store = Effect.fnUntraced(function* (source: Source) {
        yield* sql`
          INSERT INTO catalog_outline
            (indicator, source, annual, countries, first, last, dimensions, fingerprint)
          SELECT value ->> 'indicator', ${source}, value ->> 'annual',
            value -> 'countries', value ->> 'first', value ->> 'last',
            json_extract(value, '$.dimensions'), value ->> 'fingerprint'
          FROM catalog_outline_stage AS staged, json_each(staged.rows)
          WHERE staged.source = ${source}
          ON CONFLICT (indicator) DO UPDATE SET source = excluded.source,
            annual = excluded.annual, countries = excluded.countries,
            first = excluded.first, last = excluded.last,
            dimensions = excluded.dimensions, fingerprint = excluded.fingerprint
        `
        yield* sql`
          INSERT OR IGNORE INTO catalog_label (source, codelist, code)
          SELECT ${source}, dimension.value ->> 'codelist', code.value
          FROM catalog_outline_stage AS staged, json_each(staged.rows) AS row,
            json_each(row.value, '$.dimensions') AS dimension,
            json_each(dimension.value, '$.codes') AS code
          WHERE staged.source = ${source} AND row.value ->> 'searchable' AND dimension.value ->> 'codelist' IS NOT NULL
        `
      })

      const write = <E>(source: Source, outlines: Stream.Stream<Outline, E>) =>
        Effect.gen(function* () {
          yield* sql`DELETE FROM catalog_outline_stage WHERE source = ${source}`.pipe(Effect.orDie)

          const stored = new Map(
            (yield* prints(source).pipe(Effect.orDie)).map(({ indicator, fingerprint: print }) => [
              indicator,
              print,
            ]),
          )

          const seen: Array<IndicatorId> = []
          let written = 0

          yield* outlines.pipe(
            Stream.mapEffect((outline) =>
              Effect.gen(function* () {
                seen.push(outline.indicator)

                const print = yield* Schema.encodeEffect(OutlineJson)(outline).pipe(
                  Effect.orDie,
                  Effect.flatMap(fingerprint),
                )

                return stored.get(outline.indicator) === print
                  ? []
                  : [
                      {
                        searchable: searchable(outline),
                        indicator: outline.indicator,
                        annual: outline.annual === null ? -1 : Number(outline.annual),
                        countries: outline.countries,
                        first: outline.years?.first ?? null,
                        last: outline.years?.last ?? null,
                        dimensions: outline.dimensions,
                        fingerprint: print,
                      },
                    ]
              }),
            ),
            Stream.flattenIterable,
            Stream.grouped(perWrite),
            Stream.runForEach((rows) =>
              Effect.gen(function* () {
                const encoded = yield* Effect.forEach(rows, (row) =>
                  Schema.encodeEffect(RowJson)(row),
                ).pipe(Effect.orDie)

                for (const group of bySize(encoded)) {
                  yield* sql`INSERT INTO catalog_outline_stage (source, rows) VALUES (${source}, ${group})`.pipe(
                    Effect.orDie,
                  )
                }

                written += rows.length
              }),
            ),
          )

          if (seen.length === 0) return 0

          yield* store(source).pipe(Effect.orDie)
          yield* sql`DELETE FROM catalog_outline_stage WHERE source = ${source}`.pipe(Effect.orDie)

          const ids = yield* Schema.encodeEffect(IdsJson)(seen).pipe(Effect.orDie)

          yield* sql`
            DELETE FROM catalog_outline WHERE source = ${source}
              AND indicator NOT IN (SELECT value FROM json_each(${ids}))
          `.pipe(Effect.orDie)

          return written
        }).pipe(Effect.withSpan("Outlines.write", { attributes: { source } }))

      const unlabelled = Effect.fn("Outlines.unlabelled")(
        function* (source: Source, { after, limit }: { after: string; limit: number }) {
          // Without statistics SQLite reads the primary key, every label
          // the source has, rather than the index of codes with none.
          const rows = yield* sql<{ readonly codelist: string }>`
            SELECT DISTINCT codelist FROM catalog_label INDEXED BY catalog_unlabelled
            WHERE source = ${source} AND label IS NULL AND codelist > ${after}
            ORDER BY codelist
            LIMIT ${limit}
          `

          return rows.map(({ codelist }) => codelist)
        },
        Effect.catchTag("SqlError", Effect.die),
      )

      const label = Effect.fn("Outlines.label")(
        function* (
          source: Source,
          { codelist, labels }: { codelist: Codelist; labels: ReadonlyMap<string, string> },
        ) {
          const missing = yield* sql<{ readonly code: string }>`
            SELECT code FROM catalog_label INDEXED BY catalog_unlabelled
            WHERE source = ${source} AND codelist = ${codelist} AND label IS NULL
          `

          if (!Arr.isReadonlyArrayNonEmpty(missing)) return 0

          const json = yield* Schema.encodeEffect(LabelsJson)(
            Object.fromEntries(missing.map(({ code }) => [code, labels.get(code) ?? code])),
          )

          // Each code by its whole key: a join on json_each walks the whole
          // codelist and reads the JSON again for each code. `->>` reads a
          // text code such as "10" as a key, not an array index.
          yield* sql`
            UPDATE catalog_label SET label = ${json} ->> code
            WHERE source = ${source} AND codelist = ${codelist}
              AND code IN (SELECT key FROM json_each(${json})) AND label IS NULL
          `

          return missing.length
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      const page = SqlSchema.findAll({
        Request: Schema.Struct({ source: Schema.String, after: Schema.String }),
        Result: Described,
        execute: ({ source, after }) => sql`
          SELECT indicator, dimensions, text FROM catalog_outline
          WHERE source = ${source} AND indicator > ${after}
          ORDER BY indicator
          LIMIT ${perRead}
        `,
      })

      const describe = Effect.fn("Outlines.describe")(
        function* (source: Source) {
          const rows = yield* sql<{
            readonly codelist: string
            readonly code: string
            readonly label: string
          }>`
            SELECT codelist, code, label FROM catalog_label
            WHERE source = ${source} AND label IS NOT NULL
          `

          const labels = new Map(
            rows.map(({ codelist, code, label: text }) => [`${codelist} ${code}`, text]),
          )

          const text = (codelist: Codelist, code: string) => labels.get(`${codelist} ${code}`)

          let after = ""
          let written = 0
          let outlines = yield* page({ source, after })

          while (Arr.isReadonlyArrayNonEmpty(outlines)) {
            const changed = outlines.flatMap((outline) => {
              const described = embedded(outline, text)

              return described === outline.text
                ? []
                : [{ indicator: outline.indicator, text: described }]
            })

            if (Arr.isReadonlyArrayNonEmpty(changed)) {
              const json = yield* Schema.encodeEffect(TextsJson)(changed)

              yield* sql`
                UPDATE catalog_outline SET text = changed.value ->> 'text'
                FROM json_each(${json}) AS changed
                WHERE catalog_outline.indicator = changed.value ->> 'indicator'
              `

              written += changed.length
            }

            after = Arr.lastNonEmpty(outlines).indicator
            outlines = yield* page({ source, after })
          }

          return written
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      return Outlines.of({ write, unlabelled, label, describe })
    }),
  )
}

// A stage's first fill of one source's outlines and labels: what a build
// stores, with every label read from the source's bulk file instead of one
// request per codelist. The OECD's 50 requests an hour would take weeks of
// builds to label its 1,500 dataflows. Runs outside Workers, where the bulk
// files fit (scripts/outlines.ts). Answers how many outlines, labels and texts it
// wrote.
export const fill = Effect.fn("Structures.fill")(function* (source: SdmxSource) {
  const structures = yield* Structures
  const outlines = yield* Outlines

  const outlined = yield* outlines.write(source, structures.outlines(source))
  const labels = yield* structures.labels(source)
  const unlabelled = yield* outlines.unlabelled(source, { after: "", limit: 100_000 })

  const labelled = yield* Effect.forEach(
    unlabelled,
    (codelist) => outlines.label(source, { codelist, labels: labels.get(codelist) ?? new Map() }),
    { concurrency: 8 },
  )

  return {
    outlines: outlined,
    labels: labelled.reduce((sum, count) => sum + count, 0),
    texts: yield* outlines.describe(source),
  }
})
