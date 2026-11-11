import {
  Dimension,
  DimensionId,
  IndicatorId,
  IndicatorNotFound,
  SourceUnavailable,
  Year,
  type Observation,
} from "@openfacts/domain"
import {
  Array as Arr,
  Context,
  DateTime,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
  Stream,
} from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

import { type Adapter, Policy } from "./Adapter.ts"
import { cached } from "./Api.ts"
import { Outline } from "./Outlines.ts"
import { type Query, choose } from "./Series.ts"

const base = "https://api.insee.fr/melodi"
const dataset = "DD_CNA_AGREGATS"
const indicator = IndicatorId.make(`INSEE:${dataset}`)

const Label = Schema.Struct({
  en: Schema.optionalKey(Schema.String),
  fr: Schema.optionalKey(Schema.String),
})

const Text = Schema.Array(
  Schema.Struct({ lang: Schema.String, content: Schema.optionalKey(Schema.String) }),
)

const Metadata = Schema.Struct({
  identifier: Schema.Literal(dataset),
  title: Text,
  description: Text,
  modified: Schema.String,
})

const Range = Schema.Struct({
  range: Schema.Array(
    Schema.Struct({
      concept: Schema.Struct({ code: Schema.String, label: Label }),
      type: Schema.String,
      values: Schema.Array(
        Schema.Struct({ code: Schema.String, id: Schema.optionalKey(Schema.String), label: Label }),
      ),
    }),
  ),
})

const Row = Schema.Struct({
  dimensions: Schema.Record(Schema.String, Schema.String),
  attributes: Schema.Struct({
    UNIT_MULT: Schema.Literals(["0", "3", "6"]),
    REF_YEAR_PRICE: Schema.NullOr(Schema.String),
    OBS_STATUS: Schema.Literals(["A", "P", "L", "M"]),
    CONF_STATUS: Schema.Literal("F"),
  }),
  measures: Schema.Struct({
    OBS_VALUE_NIVEAU: Schema.Struct({ value: Schema.NullOr(Schema.Finite) }),
  }),
})

const Page = Schema.Struct({
  identifier: Schema.Literal(dataset),
  observations: Schema.Array(Row),
  paging: Schema.Struct({ isLast: Schema.Boolean, next: Schema.optionalKey(Schema.String) }),
})

const unavailable = () => new SourceUnavailable({ source: "INSEE" })
const label = (value: typeof Label.Type) => value.en || value.fr || ""

const text = (values: typeof Text.Type) =>
  values.find(({ lang }) => lang === "en")?.content ||
  values.find(({ lang }) => lang === "fr")?.content ||
  ""

// These are observation attributes, not independent series dimensions.
const attributes = new Set([
  "CONF_STATUS",
  "OBS_STATUS_FR",
  "OBS_STATUS",
  "DECIMALS",
  "UNIT_MULT",
  "MEASURE",
  "TIME_PERIOD",
  "FREQ",
])

const missing = new Set(["L", "M"])

const yearOf = (row: typeof Row.Type) => {
  const period = row.dimensions["TIME_PERIOD"] ?? ""
  const year = Number(period)

  return row.dimensions["FREQ"] === "A" &&
    /^\d{4}$/.test(period) &&
    /^\d{4}-FRANCE-F$/.test(row.dimensions["GEO"] ?? "") &&
    Schema.is(Year)(year)
    ? Option.some(year)
    : Option.none()
}

const matches = (
  row: typeof Row.Type,
  { query, dimensions }: { readonly query: Query; readonly dimensions: ReadonlyArray<Dimension> },
) => {
  const keys = new Set(["FREQ", "TIME_PERIOD", ...dimensions.map(({ id }) => String(id))])

  return (
    Object.keys(row.dimensions).every((key) => keys.has(key)) &&
    dimensions
      .filter(({ id }) => id !== "REF_YEAR_PRICE")
      .every(({ id }) => row.dimensions[id] === query.dimensions[id])
  )
}

const wanted = (year: Year, query: Query) =>
  year >= query.from && year <= query.to && query.countries.includes("FRA")

const observationOf = Effect.fn("Insee.observation")(function* (
  row: typeof Row.Type,
  { query, dimensions }: { readonly query: Query; readonly dimensions: ReadonlyArray<Dimension> },
) {
  const year = yearOf(row)

  if (Option.isNone(year)) return Option.none()

  if (!matches(row, { query, dimensions })) return yield* unavailable()

  if (
    (row.attributes.REF_YEAR_PRICE ?? "_Z") !== query.dimensions[DimensionId.make("REF_YEAR_PRICE")]
  )
    return Option.none()

  if (!wanted(year.value, query)) return Option.none()
  const value = row.measures.OBS_VALUE_NIVEAU.value

  if (value === null || missing.has(row.attributes.OBS_STATUS)) return Option.none()

  const observation: Observation = {
    country: "FRA",
    year: year.value,
    value: value * 10 ** Number(row.attributes.UNIT_MULT),
  }

  if (row.attributes.OBS_STATUS === "P")
    return Option.some<Observation>({
      country: observation.country,
      year: year.value,
      value: observation.value,
      flags: ["Provisional"],
    })

  return Option.some(observation)
})

const observationsOf = (
  rows: ReadonlyArray<typeof Row.Type>,
  options: { readonly query: Query; readonly dimensions: ReadonlyArray<Dimension> },
) => Effect.forEach(rows, (row) => observationOf(row, options)).pipe(Effect.map(Arr.getSomes))

const make = Effect.gen(function* () {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

  const get = <A, I>(url: string, schema: Schema.Codec<A, I>) =>
    client
      .get(url)
      .pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
        Effect.timeout("15 seconds"),
        Effect.mapError(unavailable),
      )

  const metadata = yield* Effect.cachedWithTTL(
    get(`${base}/catalog/${dataset}`, Metadata),
    (exit) => (Exit.isSuccess(exit) ? "1 day" : Duration.zero),
  )

  const dimensions = yield* Effect.cachedWithTTL(
    get(`${base}/range/${dataset}`, Range).pipe(
      Effect.filterOrFail(
        ({ range }) =>
          range.some(
            ({ concept, values }) =>
              concept.code === "FREQ" && values.some(({ code }) => code === "A"),
          ),
        unavailable,
      ),
      Effect.flatMap(({ range }) =>
        Schema.decodeUnknownEffect(Schema.Array(Dimension))(
          range
            .filter(({ concept }) => !attributes.has(concept.code))
            .map(({ concept, values }) => ({
              id: concept.code,
              label: label(concept.label) || concept.code,
              options: [
                ...(concept.code === "REF_YEAR_PRICE"
                  ? [{ code: "_Z", label: "No reference year (null)" }]
                  : []),
                ...values
                  .filter(
                    (value) => concept.code !== "GEO" || /^\d{4}-FRANCE-F$/.test(value.id ?? ""),
                  )
                  .map((value) => ({
                    code: value.id ?? value.code,
                    label: `${label(value.label) || value.code}${concept.code === "GEO" ? ` (${value.id})` : ""}`,
                  })),
              ],
            })),
        ).pipe(Effect.mapError(unavailable)),
      ),
    ),
    (exit) => (Exit.isSuccess(exit) ? "1 day" : Duration.zero),
  )

  const check = (id: IndicatorId) =>
    id === indicator ? Effect.void : Effect.fail(new IndicatorNotFound({ indicator: id }))

  const describe = Effect.fn("Insee.describe")(function* (id: IndicatorId) {
    yield* check(id)
    const row = yield* metadata

    return {
      indicator: {
        id,
        name: text(row.title),
        definition: `${text(row.description)} France only. Annual observations; select the exact GEO vintage and every series dimension. Values are in base units (UNIT_MULT applied); price reference year is retained in the series choice.`,
      },
      dataset: `${dataset}; Source: Insee; updated ${row.modified}`,
      retrievedAt: yield* DateTime.now,
    }
  })

  const fetch = Effect.fn("Insee.fetch")(function* (query: Query) {
    yield* check(query.indicator)
    const dims = yield* dimensions

    yield* choose(query, dims)

    const params = new URLSearchParams({
      ...query.dimensions,
      FREQ: "A",
      startPeriod: `${query.from}-01-01`,
      endPeriod: `${query.to}-12-31`,
      maxResult: "1000",
      page: "1",
    })

    // Null is a distinct reference-price state, never merged with a dated base.
    params.delete("REF_YEAR_PRICE")
    const url = `${base}/data/${dataset}?${params}`
    const observations: Array<Observation> = []
    const seen = new Set<string>()
    let next: string | undefined = url
    const pages = new Set<string>()

    while (next !== undefined) {
      if (!next.startsWith(`${base}/data/${dataset}?`) || pages.has(next))
        return yield* unavailable()
      pages.add(next)
      const page: typeof Page.Type = yield* get(next, Page)

      const values = yield* observationsOf(page.observations, { query, dimensions: dims })

      for (const observation of values) {
        if (seen.has(String(observation.year))) return yield* unavailable()
        seen.add(String(observation.year))
        observations.push(observation)
      }

      if (!page.paging.isLast && page.paging.next === undefined) return yield* unavailable()
      next = page.paging.isLast ? undefined : page.paging.next
    }

    return { observations, url, retrievedAt: yield* DateTime.now, dimensions: dims }
  })

  const outline = Effect.gen(function* () {
    const dims = yield* dimensions

    return yield* Schema.decodeUnknownEffect(Outline)({
      indicator,
      annual: true,
      countries: ["FRA"],
      years: null,
      dimensions: dims.map(({ id, options }) => ({
        id,
        codelist: null,
        codes: options.map(({ code }) => code),
        labels: Object.fromEntries(options.map(({ code, label: name }) => [code, name])),
      })),
    }).pipe(Effect.mapError(unavailable))
  })

  return Insee.of({
    policy: Policy.Api(),
    describe,
    fetch,
    list: dimensions.pipe(
      Effect.andThen(describe(indicator)),
      Effect.mapError(unavailable),
      Effect.map(({ indicator: row }) => [
        { indicator: row.id, name: row.name, definition: row.definition },
      ]),
    ),
    discovery: { outlines: Stream.fromEffect(outline) },
  })
})

// API reads only. No bulk capability and no gather enrollment.
export class Insee extends Context.Service<Insee, Adapter>()("@openfacts/server/Insee") {
  static readonly layer = Layer.effect(Insee, make)
  static readonly cached = Layer.effect(
    Insee,
    make.pipe(Effect.flatMap((adapter) => cached(adapter, "insee/v1"))),
  )
}
