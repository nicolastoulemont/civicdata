import { Code, Country, DimensionId, IndicatorId, type Source, sourceOf } from "@openfacts/domain"
import { Array as Arr, Context, Effect, Layer, Option, Record, Schema, Stream } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { areas } from "./Csv.ts"
import { fingerprint } from "./fingerprint.ts"

// What the catalog knows of a publisher's datasets. SDMX parsers supply
// the same contract as file adapters.
// The parsers here are shared by the catalog Workflow (CatalogBuild.ts) and
// the script that fills a stage's catalog the first time
// (scripts/outlines.ts).

// A codelist, as "agency:id" without its version: "ESTAT:SEX", "OECD:CL_AGE".
// The OECD names a version in each structure that its "latest" codelist file
// may have replaced; the labels of a code rarely change between versions.
export const Codelist = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.@-]+:[A-Za-z0-9_@-]+$/))

export type Codelist = typeof Codelist.Type

// One dimension of a dataset: the codes its series take, in the source's
// order, and the codelist that labels them, or null when the source does not
// say which. File adapters can label codes directly without a codelist.
export const Dimension = Schema.Struct({
  id: DimensionId,
  codelist: Schema.NullOr(Codelist),
  codes: Schema.NonEmptyArray(Code),
  labels: Schema.optionalKey(Schema.Record(Code, Schema.String)),
})

export interface Dimension extends Schema.Schema.Type<typeof Dimension> {}

// A dataset's outline: its dimensions besides country, frequency and time;
// whether it has annual values; which of our countries it covers; and its
// first and last year with an annual value, or with any value where the
// source does not tell them apart (the OECD). Null means unknown, while
// false annual or empty countries confirm exclusion. Countries and years are
// bounds for the whole dataset, not for each series: find_years gives those.
export const Outline = Schema.Struct({
  indicator: IndicatorId,
  dimensions: Schema.Array(Dimension),
  annual: Schema.NullOr(Schema.Boolean),
  countries: Schema.NullOr(Schema.Array(Country)),
  years: Schema.NullOr(Schema.Struct({ first: Schema.Int, last: Schema.Int })),
})

export interface Outline extends Schema.Schema.Type<typeof Outline> {}

// A chart shows annual values of some of our countries, so a dataset with no
// annual values, or none of our countries, is left out of the catalog's
// search.
export const searchable = (outline: Pick<Outline, "annual" | "countries">) =>
  outline.annual !== false && (outline.countries === null || outline.countries.length > 0)

const isCode = Schema.is(Code)
const isDimension = Schema.is(DimensionId)
const toIndicator = Schema.decodeUnknownOption(IndicatorId)

const years = (found: ReadonlyArray<number>) =>
  found.length === 0 ? null : { first: Math.min(...found), last: Math.max(...found) }

// A dimension's codes as an outline stores them: the ones a code can be, each
// once, or none when no code is.
const dimension = (id: string, codelist: Codelist | null, codes: Iterable<string>) => {
  const kept = [...new Set(codes)].filter(isCode)

  return isDimension(id) && Arr.isArrayNonEmpty(kept)
    ? Option.some({ id, codelist, codes: kept })
    : Option.none()
}

// The dataset whose lines the metabase is reading.
interface Draft {
  readonly dataset: string
  readonly dimensions: Map<string, Array<string>>
  readonly countries: Set<Country>
  readonly years: Array<number>
  annual: boolean
}

const eurostatCountry = areas.Eurostat.country

const finish = (draft: Draft | undefined): ReadonlyArray<Outline> => {
  if (draft === undefined) return []

  const indicator = toIndicator(`ESTAT,${draft.dataset.toUpperCase()},1.0`)

  if (Option.isNone(indicator)) return []

  return [
    {
      indicator: indicator.value,
      dimensions: [...draft.dimensions].flatMap(([id, codes]) =>
        Option.toArray(dimension(id, `ESTAT:${id.toUpperCase()}`, codes)),
      ),
      annual: draft.annual,
      countries: [...draft.countries].toSorted(),
      years: years(draft.years),
    },
  ]
}

// Add a metabase code to its country's, period's or series' dimension.
const addCode = (draft: Draft, { id, code }: { id: string; code: string }) => {
  if (id === "geo") {
    const country = eurostatCountry.get(code)

    if (country !== undefined) draft.countries.add(country)
  } else if (id === "time") {
    if (/^\d{4}$/.test(code)) {
      draft.annual = true
      draft.years.push(Number(code))
    }
  } else if (id !== "freq") {
    const codes = draft.dimensions.get(id)

    if (codes === undefined) draft.dimensions.set(id, [code])
    else codes.push(code)
  }
}

// One line of the metabase, "dataset<TAB>dimension<TAB>code", read into the
// dataset it belongs to. The file lists each dataset's lines together, so a
// new dataset finishes the one before. It names no frequency: a period of
// four digits ("2024") is a year, any other ("2024-Q1", "2024-01") is not.
// Every dimension's codelist has the dimension's id, in capitals.
const readLine = (
  draft: Draft | undefined,
  line: string,
): readonly [Draft | undefined, ReadonlyArray<Outline>] => {
  const [dataset = "", id = "", code = ""] = line.split("\t")

  if (dataset === "" || id === "" || code === "") return [draft, []]

  const current: Draft =
    draft?.dataset === dataset
      ? draft
      : { dataset, dimensions: new Map(), countries: new Set(), years: [], annual: false }

  addCode(current, { id, code })

  return [current, current === draft ? [] : finish(draft)]
}

// Eurostat's metabase, `catalogue/metabase.txt.gz` once unzipped: every
// dimension and code in use of every dataset, one per line. Read as it
// streams, a dataset at a time, so a Worker never holds the 34 MB file.
const start = (): Draft | undefined => undefined

export const metabase = <E, R>(lines: Stream.Stream<string, E, R>) =>
  lines.pipe(Stream.mapAccum(start, readLine, { onHalt: finish }))

const KeyValue = Schema.Struct({
  id: Schema.String,
  values: Schema.optionalKey(Schema.Array(Schema.String)),
  timeRange: Schema.optionalKey(
    Schema.Struct({
      startPeriod: Schema.optionalKey(Schema.Struct({ period: Schema.String })),
      endPeriod: Schema.optionalKey(Schema.Struct({ period: Schema.String })),
    }),
  ),
})

// The OECD's content constraints: for each dataflow, the codes its data
// takes ("Actual") and the codes its structure allows ("Allowed").
export const Constraints = Schema.Struct({
  data: Schema.Struct({
    contentConstraints: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        constraintAttachment: Schema.Struct({
          dataflows: Schema.optionalKey(Schema.Array(Schema.String)),
        }),
        cubeRegions: Schema.optionalKey(
          Schema.Array(Schema.Struct({ keyValues: Schema.optionalKey(Schema.Array(KeyValue)) })),
        ),
      }),
    ),
  }),
})

// The OECD's data structures: each one's dimensions and the codelist of
// each.
export const DataStructures = Schema.Struct({
  data: Schema.Struct({
    dataStructures: Schema.Array(
      Schema.Struct({
        agencyID: Schema.String,
        id: Schema.String,
        dataStructureComponents: Schema.Struct({
          dimensionList: Schema.Struct({
            dimensions: Schema.Array(
              Schema.Struct({
                id: Schema.String,
                localRepresentation: Schema.optionalKey(
                  Schema.Struct({ enumeration: Schema.optionalKey(Schema.String) }),
                ),
              }),
            ),
          }),
        }),
      }),
    ),
  }),
})

// "urn:...=OECD.SDD.TPS:DSD_LFS@DF_IALFS_UNE_M(1.0)" → its agency, id and
// version.
const urn = (text: string) => {
  const found = /=([^:=]+):([^:(]+)\(([^)]+)\)$/.exec(text)

  return found === null
    ? undefined
    : { agency: found[1] ?? "", id: found[2] ?? "", version: found[3] ?? "" }
}

const year = (period: string | undefined) => {
  const found = period === undefined ? Number.NaN : Number(period.slice(0, 4))

  return Number.isInteger(found) ? [found] : []
}

const oecdCountries = areas.OECD.country

// Combine the codes and time bounds from a constraint's cube regions.
const regionValues = (
  regions: ReadonlyArray<{ readonly keyValues?: ReadonlyArray<typeof KeyValue.Type> }>,
) => {
  const values = new Map<string, Array<string>>()
  const found: Array<number> = []

  for (const { id, values: codes = [], timeRange } of regions.flatMap(
    (region) => region.keyValues ?? [],
  )) {
    if (id === "TIME_PERIOD") {
      found.push(...year(timeRange?.startPeriod?.period), ...year(timeRange?.endPeriod?.period))
    } else values.set(id, [...(values.get(id) ?? []), ...codes])
  }

  return { values, found }
}

const oecdIndicator = (flow: ReturnType<typeof urn>) => {
  if (flow === undefined) return Option.none()

  return toIndicator(`${flow.agency},${flow.id},${flow.version}`).pipe(
    Option.filter((indicator) => sourceOf(indicator) === "OECD"),
  )
}

const coveredCountries = (codes: ReadonlyArray<string> = []) =>
  [...new Set(codes.flatMap((code) => oecdCountries.get(code) ?? []))].toSorted()

const seriesDimensions = (
  values: ReadonlyMap<string, ReadonlyArray<string>>,
  listed: ReadonlyMap<string, Codelist>,
) =>
  [...values].flatMap(([id, codes]) =>
    id === "REF_AREA" || id === "FREQ"
      ? []
      : Option.toArray(dimension(id, listed.get(id) ?? null, codes)),
  )

// Some dataflows have several Actual constraints. Combine their regions
// before decoding the outline, so a dataflow has one stable fingerprint.
const actualConstraints = (
  constraints: (typeof Constraints.Type)["data"]["contentConstraints"],
) => {
  const flows = new Map<string, (typeof constraints)[number]>()

  for (const constraint of constraints) {
    if (constraint.type !== "Actual") continue

    const flow = constraint.constraintAttachment.dataflows?.[0] ?? ""
    const previous = flows.get(flow)

    flows.set(flow, {
      ...constraint,
      cubeRegions: [...(previous?.cubeRegions ?? []), ...(constraint.cubeRegions ?? [])],
    })
  }

  return [...flows.values()]
}

// The outline of each OECD dataflow with a constraint on the codes its data
// takes, from the constraints and the structures, both decoded from JSON.
// A dataflow's structure is the one its id names before "@", of its own
// agency if two agencies define one. Its frequency dimension lists "A" when
// it has annual values; a dataflow without one is taken as annual, as the
// data requests that leave frequency out (Sdmx.ts). A dataflow without a
// constraint, or one whose structure the file lacks, keeps no outline or no
// codelists.
export const constraints = ({
  constraints: { data },
  structures: {
    data: { dataStructures: structures },
  },
}: {
  readonly constraints: typeof Constraints.Type
  readonly structures: typeof DataStructures.Type
}): ReadonlyArray<Outline> => {
  const codelists = (agency: string, dataflow: string) => {
    const id = dataflow.split("@")[0]

    const named = structures.filter((structure) => structure.id === id)

    const structure =
      named.find((each) => each.agencyID === agency) ?? (named.length === 1 ? named[0] : undefined)

    return new Map(
      (structure?.dataStructureComponents.dimensionList.dimensions ?? []).flatMap((each) => {
        const enumeration = urn(each.localRepresentation?.enumeration ?? "")

        return enumeration === undefined
          ? []
          : [[each.id, `${enumeration.agency}:${enumeration.id}`] as const]
      }),
    )
  }

  return actualConstraints(data.contentConstraints).flatMap(
    (constraint): ReadonlyArray<Outline> => {
      const flow = urn(constraint.constraintAttachment.dataflows?.[0] ?? "")
      const regions = constraint.cubeRegions ?? []

      if (flow === undefined || regions.length === 0) return []

      const indicator = oecdIndicator(flow)

      if (Option.isNone(indicator)) return []

      const listed = codelists(flow.agency, flow.id)
      const { values, found } = regionValues(regions)

      const frequencies = values.get("FREQ")

      return [
        {
          indicator: indicator.value,
          dimensions: seriesDimensions(values, listed),
          annual: frequencies === undefined || frequencies.includes("A"),
          countries: coveredCountries(values.get("REF_AREA")),
          years: years(found),
        },
      ]
    },
  )
}

// The label of each code of some codelists.
export type Labels = ReadonlyMap<Codelist, ReadonlyMap<string, string>>

// One Eurostat codelist as JSON-stat, alone or in a collection.
const EurostatCodelist = Schema.Struct({
  category: Schema.Struct({ label: Schema.Record(Schema.String, Schema.String) }),
  extension: Schema.Struct({ id: Schema.String }),
})

export const EurostatCodelists = Schema.Union([
  Schema.Struct({ link: Schema.Struct({ item: Schema.Array(EurostatCodelist) }) }),
  EurostatCodelist,
])

// Eurostat's codelists: every one at once (58 MB), or one.
export const eurostatLabels = (decoded: typeof EurostatCodelists.Type): Labels =>
  new Map(
    ("link" in decoded ? decoded.link.item : [decoded]).map(({ category, extension }) => [
      `ESTAT:${extension.id}`,
      new Map(Object.entries(category.label)),
    ]),
  )

export const OecdCodelists = Schema.Struct({
  data: Schema.Struct({
    codelists: Schema.Array(
      Schema.Struct({
        agencyID: Schema.String,
        id: Schema.String,
        codes: Schema.optionalKey(
          Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
        ),
      }),
    ),
  }),
})

// The OECD's codelists: every one at once (33 MB), or one.
export const oecdLabels = ({ data }: typeof OecdCodelists.Type): Labels => {
  const labels = new Map<Codelist, Map<string, string>>()

  for (const { agencyID, id, codes = [] } of data.codelists) {
    const key = `${agencyID}:${id}`
    const known = labels.get(key) ?? new Map<string, string>()

    for (const code of codes) known.set(code.id, code.name)

    labels.set(key, known)
  }

  return labels
}

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
export class Outlines extends Context.Service<Outlines, Interface>()("@openfacts/server/Outlines") {
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
