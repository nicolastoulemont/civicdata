import {
  Country,
  Dimension,
  DimensionId,
  IndicatorId,
  IndicatorNotFound,
  type Observation,
  Qualification,
  SourceUnavailable,
  Year,
} from "@repo/domain"
import { Context, DateTime, Duration, Effect, Exit, Layer, Schema, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

import { type Adapter, Policy } from "../series/Adapter.ts"
import { Outline } from "../series/Outlines.ts"
import { type Query, choose } from "../series/Series.ts"
import { cached } from "./Api.ts"

const base = "https://xmart-api-public.who.int"
const route = `${base}/DATA_/RELAY_MAY2023`
const indicator = IndicatorId.make("WHO:WHOSIS_000001")
const unavailable = () => new SourceUnavailable({ source: "WHO" })

const dimensions = Schema.decodeUnknownSync(Schema.Array(Dimension))([
  {
    id: "SEX",
    label: "Sex",
    options: [
      { code: "FEMALE", label: "Female" },
      { code: "MALE", label: "Male" },
      { code: "TOTAL", label: "Both sexes" },
    ],
  },
  { id: "AGE", label: "Age", options: [{ code: "BIRTH", label: "At birth" }] },
  { id: "UNIT", label: "Unit", options: [{ code: "YEARS", label: "Years" }] },
])

// WHO 2026 life-table methods p.3 describes unresolved national-scope exclusions.
const excluded = new Set(["CYP", "GEO", "MDA", "RUS", "SRB", "SGP", "MUS"])

const methodUrl =
  "https://cdn.who.int/media/docs/default-source/gho-documents/global-health-estimates/ghe2023_lifetable_methods.pdf?sfvrsn=d5132ed3_2"

const nullable = Schema.NullOr(Schema.String)

const Metadata = Schema.Struct({
  IND_CODE_GHO: Schema.Literal("WHOSIS_000001"),
  SOURCE_CODE: Schema.Null,
  DATA_PROVENANCE: Schema.Literal("OFFICIAL_ESTIMATE"),
  VALUE_CONFIDENCE: Schema.Literal(false),
  IND_NAME_FULL: Schema.NonEmptyString,
  IND_ABSTRACT: Schema.String,
  IND_URI_API: Schema.Literal("https://frontdoor-l4uikgap6gz3m.azurefd.net/DATA_/RELAY_MAY2023"),
  IND_PUBLISH_TABLE: Schema.Literal("https://extranet.who.int/xmart4/DATA_/data/RELAY_MAY2023"),
  IND_PUBLISH_STATUS: Schema.Literal(1),
  IND_PUBLISH_SENSITIVITY: Schema.Literal("PERMISSION_PUBLIC"),
  VALUE_UNIT_LABEL_FULL: Schema.Literal("years"),
  DIM_GEO_GRANULARITY: Schema.Literal("NATIONAL"),
  Sys_VersionID: Schema.NonEmptyString,
  Sys_CommitDateUtc: Schema.DateTimeUtcFromString,
})

const Geography = Schema.Struct({
  GEO_M49_CODE: Schema.String.check(Schema.isPattern(/^\d{3}$/)),
  CODE_ISO_3: nullable,
  WHO_LEGAL_STATUS: nullable,
})

const unused = Object.fromEntries(
  Array.from({ length: 8 }, (_, i) => i + 2).flatMap((i) => [
    [`DIM_${i}_CODE`, Schema.Null],
    [`DIM_MEMBER_${i}_CODE`, Schema.Null],
  ]),
)

const Row = Schema.Struct({
  IND_CODE: Schema.Literal("WHOSIS_000001"),
  IND_ID: Schema.Literal("90E2E48WHOSIS_000001"),
  DIM_TIME: Schema.String.check(Schema.isPattern(/^\d{4}$/)),
  DIM_TIME_TYPE: Schema.Literal("YEAR"),
  DIM_GEO_CODE_TYPE: Schema.Literal("COUNTRY"),
  DIM_GEO_CODE_M49: Schema.String,
  DIM_1_CODE: Schema.Literal("DIM_SEX"),
  DIM_MEMBER_1_CODE: Schema.Literals(["FEMALE", "MALE", "TOTAL"]),
  ...unused,
  DIM_VALUE_TYPE: Schema.Literal("AMOUNT"),
  DIM_PUBLISH_STATE_CODE: Schema.Literal("PUBLISHED"),
  VALUE_NUMERIC: Schema.NullOr(Schema.Finite),
  VALUE_NUMERIC_LOWER: Schema.NullOr(Schema.Finite),
  VALUE_NUMERIC_UPPER: Schema.NullOr(Schema.Finite),
  VALUE_LABEL: nullable,
  VALUE_LABEL_LOWER: nullable,
  VALUE_LABEL_UPPER: nullable,
  VALUE_COMMENTS: nullable,
  VALUE_PROVENANCE: nullable,
  VALUE_CALC_TYPE: nullable,
  OBSERVATION_STATUS: nullable,
  Sys_VersionID: Schema.NonEmptyString,
  Sys_CommitDateUtc: Schema.DateTimeUtcFromString,
})

const pageOf = <A, I>(row: Schema.Codec<A, I>) =>
  Schema.Struct({
    value: Schema.Array(row),
    "@odata.count": Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    "@odata.nextLink": Schema.optionalKey(Schema.String),
  })

const continuation = Effect.fn("Who.continuation")(function* (
  link: string | undefined,
  expected: URL,
) {
  if (link === undefined) return undefined
  const linked = yield* Effect.try({ try: () => new URL(link, expected), catch: unavailable })

  if (linked.href !== expected.href) return yield* unavailable()

  return undefined
})

const matches = (row: typeof Row.Type, query: Query) =>
  row.DIM_MEMBER_1_CODE === query.dimensions[DimensionId.make("SEX")] &&
  Number(row.DIM_TIME) >= query.from &&
  Number(row.DIM_TIME) <= query.to

const make = Effect.gen(function* () {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

  // Count + deterministic skip avoids relying on the public API's 120,000-row cap.
  const pages = Effect.fn("Who.pages")(function* <A, I>(
    path: string,
    options: { schema: Schema.Codec<A, I>; filter: string; order: string; limit: number },
  ) {
    const values: A[] = []
    let total: number | undefined
    const first = new URL(path)
    first.search = new URLSearchParams({
      $filter: options.filter,
      $orderby: options.order,
      $top: "1000",
      $skip: "0",
      $count: "true",
    }).toString()
    let next: URL | undefined = first

    while (next !== undefined) {
      const page = yield* client
        .get(next.href)
        .pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(pageOf(options.schema))),
          Effect.timeout("30 seconds"),
          Effect.mapError(unavailable),
        )

      total ??= page["@odata.count"]

      if (
        total > options.limit ||
        total !== page["@odata.count"] ||
        values.length + page.value.length > total
      )
        return yield* unavailable()
      values.push(...page.value)

      if (values.length === total) {
        if (page["@odata.nextLink"] !== undefined) return yield* unavailable()
        next = undefined
      } else {
        if (page.value.length === 0) return yield* unavailable()
        const expected = new URL(first)
        expected.searchParams.set("$skip", String(values.length))

        yield* continuation(page["@odata.nextLink"], expected)

        next = expected
      }
    }

    return { values, url: first.href }
  })

  const metadata = yield* Effect.cachedWithTTL(
    pages(`${base}/DATA_/IND_DIRECTORY`, {
      schema: Metadata,
      filter: "IND_CODE_GHO eq 'WHOSIS_000001'",
      order: "IND_ID",
      limit: 1,
    }).pipe(
      Effect.flatMap(({ values }) =>
        values[0] === undefined ? Effect.fail(unavailable()) : Effect.succeed(values[0]),
      ),
    ),
    (exit) => (Exit.isSuccess(exit) ? "1 day" : Duration.zero),
  )

  const geography = yield* Effect.cachedWithTTL(
    pages(`${base}/REFMART/REF_COUNTRY`, {
      schema: Geography,
      filter: "WHO_LEGAL_STATUS eq 'M'",
      order: "GEO_M49_CODE",
      limit: 300,
    }).pipe(
      Effect.flatMap(({ values }) =>
        Effect.gen(function* () {
          const map = new Map<string, Country>()
          const codes = new Set<Country>()

          for (const row of values) {
            if (row.WHO_LEGAL_STATUS !== "M") return yield* unavailable()

            if (!Schema.is(Country)(row.CODE_ISO_3) || excluded.has(row.CODE_ISO_3)) continue

            if (map.has(row.GEO_M49_CODE) || codes.has(row.CODE_ISO_3)) return yield* unavailable()
            map.set(row.GEO_M49_CODE, row.CODE_ISO_3)
            codes.add(row.CODE_ISO_3)
          }

          return map
        }),
      ),
    ),
    (exit) => (Exit.isSuccess(exit) ? "1 day" : Duration.zero),
  )

  const describe = Effect.fn("Who.describe")(function* (id: IndicatorId) {
    if (id !== indicator) return yield* new IndicatorNotFound({ indicator: id })
    const row = yield* metadata

    return {
      indicator: {
        id,
        name: row.IND_NAME_FULL,
        definition: `${row.IND_ABSTRACT} Period life expectancy at birth under the year's mortality rates, not a forecast. WHO estimates may differ from nationally endorsed statistics. Select sex, age and unit. Published 95% uncertainty bounds follow WHO life-table methods (2026), section 5.2: Monte Carlo draws and tail quantiles, not HPD intervals. Countries with unresolved territorial or resident-population scope are excluded.`,
      },
      dataset: `World Health Organization; Global Health Estimates; WHOSIS_000001; ${row.IND_URI_API}; metadata ${row.Sys_VersionID}, updated ${DateTime.formatIso(row.Sys_CommitDateUtc)}; CC BY 4.0 with WHO additional terms`,
      retrievedAt: yield* DateTime.now,
      dimensions,
    }
  })

  const fetch = Effect.fn("Who.fetch")(function* (query: Query) {
    if (query.indicator !== indicator)
      return yield* new IndicatorNotFound({ indicator: query.indicator })

    yield* choose(query, dimensions)

    yield* metadata
    const map = yield* geography

    const m49 = [...map].flatMap(([code, country]) =>
      query.countries.includes(country) ? [code] : [],
    )

    if (m49.length === 0)
      return {
        observations: [],
        qualifications: [],
        dimensions,
        url: route,
        retrievedAt: yield* DateTime.now,
      }
    const filter = `IND_CODE eq 'WHOSIS_000001' and DIM_GEO_CODE_TYPE eq 'COUNTRY' and (${m49.map((code) => `DIM_GEO_CODE_M49 eq '${code}'`).join(" or ")}) and DIM_MEMBER_1_CODE eq '${query.dimensions[DimensionId.make("SEX")]}' and DIM_TIME ge '${query.from}' and DIM_TIME le '${query.to}'`

    const result = yield* pages(route, {
      schema: Row,
      filter,
      order: "DIM_GEO_CODE_M49,DIM_TIME,Sys_ID",
      limit: 30000,
    })

    const observations: Observation[] = []
    const qualifications: Qualification[] = []
    const seen = new Set<string>()

    for (const row of result.values) {
      const country = map.get(row.DIM_GEO_CODE_M49)

      const year = yield* Schema.decodeUnknownEffect(Year)(Number(row.DIM_TIME)).pipe(
        Effect.mapError(unavailable),
      )

      if (
        country === undefined ||
        !query.countries.includes(country) ||
        !matches(row, query) ||
        seen.has(`${country}:${year}`)
      )
        return yield* unavailable()
      seen.add(`${country}:${year}`)

      const notes = Object.entries({
        METHOD: `WHO life-table methods 2026, section 5.2: 1,000 Monte Carlo draws, 2.5th and 97.5th percentiles; ${methodUrl}`,
        OBSERVATION_STATUS: row.OBSERVATION_STATUS,
        VALUE_LABEL: row.VALUE_LABEL,
        VALUE_LABEL_LOWER: row.VALUE_LABEL_LOWER,
        VALUE_LABEL_UPPER: row.VALUE_LABEL_UPPER,
        VALUE_COMMENTS: row.VALUE_COMMENTS,
        VALUE_PROVENANCE: row.VALUE_PROVENANCE,
        VALUE_CALC_TYPE: row.VALUE_CALC_TYPE,
        DIM_PUBLISH_STATE_CODE: row.DIM_PUBLISH_STATE_CODE,
        Sys_CommitDateUtc: DateTime.formatIso(row.Sys_CommitDateUtc),
      }).flatMap(([code, label]) =>
        label === null || label === "" ? [] : [{ category: "Publisher", code, label }],
      )

      const item = yield* Schema.decodeUnknownEffect(Qualification)({
        source: "WHO",
        level: 0.95,
        method: "MonteCarloQuantiles",
        methodUrl,
        series: { indicator, dimensions: query.dimensions },
        country,
        year,
        missing: row.VALUE_NUMERIC === null,
        estimate: row.VALUE_NUMERIC,
        lower: row.VALUE_NUMERIC_LOWER,
        upper: row.VALUE_NUMERIC_UPPER,
        version: row.Sys_VersionID,
        notes,
      }).pipe(Effect.mapError(unavailable))

      qualifications.push(item)

      if (row.VALUE_NUMERIC !== null)
        observations.push({ country, year, value: row.VALUE_NUMERIC, flags: ["Estimated"] })
    }

    return {
      observations,
      qualifications,
      dimensions,
      url: result.url,
      retrievedAt: yield* DateTime.now,
    }
  })

  const outline = metadata.pipe(
    Effect.andThen(
      Schema.decodeUnknownEffect(Outline)({
        indicator,
        annual: true,
        countries: null,
        years: null,
        dimensions: dimensions.map(({ id, options }) => ({
          id,
          codelist: null,
          codes: options.map((o) => o.code),
          labels: Object.fromEntries(options.map((o) => [o.code, o.label])),
        })),
      }),
    ),
    Effect.mapError(unavailable),
  )

  return Who.of({
    policy: Policy.Api(),
    describe,
    fetch,
    list: describe(indicator).pipe(
      Effect.map(({ indicator: row }) => [
        { indicator: row.id, name: row.name, definition: row.definition },
      ]),
      Effect.mapError(unavailable),
    ),
    discovery: { outlines: Stream.fromEffect(outline) },
  })
})

export class Who extends Context.Service<Who, Adapter>()("@repo/server/Who") {
  static readonly layer = Layer.effect(Who, make)
  static readonly cached = Layer.effect(
    Who,
    make.pipe(Effect.flatMap((adapter) => cached(adapter, "who/v1"))),
  )
}
