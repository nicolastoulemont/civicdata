import { expect, it } from "@effect/vitest"
import {
  Dimensions,
  DimensionsMissing,
  IndicatorId,
  IndicatorNotFound,
  SourceUnavailable,
  Trend,
  Year,
} from "@repo/domain"
import { Effect, Layer, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"

import { Catalog } from "../../catalog/Catalog.ts"
import { Directions } from "../../catalog/Directions.ts"
import { build, catalogOver, listings } from "../../catalog/tests/catalog.ts"
import { http, memory } from "../../tests/fakes.ts"
import countries from "../../tests/fixtures/who/countries.json"
import directory from "../../tests/fixtures/who/directory.json"
import series from "../../tests/fixtures/who/series.json"
import { Resolver } from "../../views/Resolver.ts"
import { summarize } from "../../views/utils/summarize.ts"
import { Sources } from "../Sources.ts"
import { Who } from "../Who.ts"

const indicator = IndicatorId.make("WHO:WHOSIS_000001")

const dimensions = Schema.decodeUnknownSync(Dimensions)({
  SEX: "TOTAL",
  AGE: "BIRTH",
  UNIT: "YEARS",
})

const query = {
  indicator,
  dimensions,
  countries: ["FRA"] as const,
  from: Year.make(2022),
  to: Year.make(2023),
}

const respond = (url: string) => {
  const parsed = new URL(url)

  if (parsed.pathname.endsWith("IND_DIRECTORY")) return Response.json(directory)

  if (parsed.pathname.endsWith("REF_COUNTRY")) return Response.json(countries)
  const skip = Number(parsed.searchParams.get("$skip"))

  return Response.json({ ...series, value: series.value.slice(skip, skip + 1) })
}

const replay = Who.layer.pipe(Layer.provide(http(respond)))

it.effect(
  "discovers only the reviewed indicator, with explicit singleton choices and unknown coverage",
  () =>
    Effect.gen(function* () {
      const source = yield* Who
      expect((yield* source.list).map((row) => row.indicator)).toEqual([indicator])
      const outlines = yield* Stream.runCollect(source.discovery?.outlines ?? Stream.empty)
      expect(outlines[0]).toMatchObject({ countries: null, years: null, annual: true })
      const error = yield* source.fetch({ ...query, dimensions: {} }).pipe(Effect.flip)
      expect(error).toBeInstanceOf(DimensionsMissing)

      if (error instanceof DimensionsMissing) {
        expect(error.dimensions.map((row) => row.options.length)).toEqual([3, 1, 1])
        expect(error.open).toEqual(["SEX", "AGE", "UNIT"])
      }

      expect(
        yield* source
          .fetch({
            ...query,
            dimensions: Schema.decodeUnknownSync(Dimensions)({
              ...dimensions,
              SEX: "OTHER",
            }),
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(DimensionsMissing)
      expect(
        yield* source.describe(IndicatorId.make("WHO:unknown")).pipe(Effect.flip),
      ).toBeInstanceOf(IndicatorNotFound)
      expect(source.bulk).toBeUndefined()
    }).pipe(Effect.provide(replay)),
)

it.effect("reads filtered national pages with exact published bounds, versions and notes", () =>
  Effect.gen(function* () {
    const answer = yield* (yield* Who).fetch(query)
    expect(answer.observations.map((row) => row.value)).toEqual(
      series.value.map((row) => row.VALUE_NUMERIC),
    )
    expect(answer.qualifications?.[0]).toMatchObject({
      source: "WHO",
      level: 0.95,
      method: "MonteCarloQuantiles",
      estimate: 81.9,
      lower: 81.7,
      upper: 82.1,
      version: series.value[0]?.Sys_VersionID,
      notes: expect.arrayContaining([
        { category: "Publisher", code: "VALUE_LABEL", label: "81.9 [81.7-82.1]" },
      ]),
    })
    expect(new URL(answer.url).searchParams.get("$filter")).toContain("DIM_GEO_CODE_M49 eq '250'")
    expect(new URL(answer.url).searchParams.get("$filter")).toContain(
      "DIM_MEMBER_1_CODE eq 'TOTAL'",
    )
    expect((yield* (yield* Who).fetch({ ...query, countries: ["XKX"] })).observations).toEqual([])
    expect(
      (yield* (yield* Who).fetch({
        ...query,
        countries: ["CYP", "GEO", "MDA", "RUS", "SRB", "SGP", "MUS"],
      })).observations,
    ).toEqual([])
  }).pipe(Effect.provide(replay)),
)

it.effect("keeps a missing-only publisher record without manufacturing an observation", () =>
  Effect.gen(function* () {
    const answer = yield* (yield* Who).fetch(query)
    expect(answer.observations).toEqual([])
    expect(answer.qualifications?.[0]).toMatchObject({
      missing: true,
      estimate: null,
      lower: null,
      upper: null,
      notes: expect.arrayContaining([
        { category: "Publisher", code: "OBSERVATION_STATUS", label: "M" },
      ]),
    })
  }).pipe(
    Effect.provide(
      Who.layer.pipe(
        Layer.provide(
          http((url) =>
            url.includes("RELAY_MAY2023")
              ? Response.json({
                  ...series,
                  "@odata.count": 1,
                  value: [
                    {
                      ...series.value[0],
                      VALUE_NUMERIC: null,
                      VALUE_NUMERIC_LOWER: null,
                      VALUE_NUMERIC_UPPER: null,
                      OBSERVATION_STATUS: "M",
                    },
                  ],
                })
              : respond(url),
          ),
        ),
      ),
    ),
  ),
)

const failures = {
  dependency: (url) =>
    new URL(url).searchParams.get("$skip") === "0"
      ? respond(url)
      : new Response("down", { status: 503 }),
  text: () => new Response("Table not found"),
  empty: (url) =>
    new URL(url).searchParams.get("$skip") === "0"
      ? respond(url)
      : Response.json({ ...series, value: [] }),
  count: (url) =>
    new URL(url).searchParams.get("$skip") === "0"
      ? respond(url)
      : Response.json({ ...series, "@odata.count": 3, value: series.value.slice(1) }),
  duplicate: () => Response.json({ ...series, value: [series.value[0], series.value[0]] }),
  filter: () =>
    Response.json({
      ...series,
      value: series.value.map((row) => ({ ...row, DIM_MEMBER_1_CODE: "MALE" })),
    }),
  bounds: () =>
    Response.json({
      ...series,
      value: series.value.map((row) => ({ ...row, VALUE_NUMERIC_LOWER: 999 })),
    }),
  dimension: () =>
    Response.json({ ...series, value: series.value.map((row) => ({ ...row, DIM_2_CODE: "AGE" })) }),
  host: () =>
    Response.json({
      ...series,
      value: series.value.slice(0, 1),
      "@odata.nextLink": "https://example.com/data",
    }),
  cycle: (url) =>
    Response.json({ ...series, value: series.value.slice(0, 1), "@odata.nextLink": url }),
} satisfies Record<string, (url: string) => Response>

for (const [failure, reject] of Object.entries(failures)) {
  it.effect(`rejects ${failure} instead of publishing a partial series`, () =>
    Effect.gen(function* () {
      expect(yield* (yield* Who).fetch(query).pipe(Effect.flip)).toBeInstanceOf(SourceUnavailable)
    }).pipe(
      Effect.provide(
        Who.layer.pipe(
          Layer.provide(
            http((url) => (url.includes("RELAY_MAY2023") ? reject(url) : respond(url))),
          ),
        ),
      ),
    ),
  )
}

it.effect("reuses find_years range data and original retrieval time for a narrower chart", () => {
  let reads = 0

  return Effect.gen(function* () {
    yield* TestClock.setTime(new Date("2026-11-11T00:00:00Z").getTime())
    const source = yield* Who
    const coverage = yield* source.fetch({ ...query, from: Year.make(1996), to: Year.make(2026) })
    const chart = yield* source.fetch({ ...query, from: Year.make(2023) })
    expect(chart.observations).toHaveLength(1)
    expect(chart.qualifications).toHaveLength(1)
    expect(chart.retrievedAt).toEqual(coverage.retrievedAt)
    expect(reads).toBe(2)
  }).pipe(
    Effect.provide(
      Who.cached.pipe(
        Layer.provide(memory().layer),
        Layer.provide(
          http((url) => {
            if (url.includes("RELAY_MAY2023")) reads++

            return respond(url)
          }),
        ),
      ),
    ),
  )
})

it.effect("publishes bounded catalog discovery then resolves a chart with source attribution", () =>
  Effect.gen(function* () {
    const source = yield* Who
    yield* Effect.gen(function* () {
      yield* build(20)
      const catalog = yield* Catalog
      expect(
        (yield* catalog.search("life expectancy", { source: "WHO" })).map((row) => row.indicator),
      ).toContain(indicator)
      expect((yield* catalog.outlines([indicator])).get(indicator)?.countries).toBeNull()
    }).pipe(Effect.provide(catalogOver(listings({ WHO: [] }), { adapters: { WHO: source } })))

    const resolved = yield* Effect.gen(function* () {
      return yield* (yield* Resolver).resolve(Trend.make(query))
    }).pipe(
      Effect.provide(
        Resolver.layer.pipe(
          Layer.provide(Directions.listed),
          Layer.provide(
            Layer.succeed(
              Sources,
              Sources.of({ "World Bank": source, Eurostat: source, OECD: source, WHO: source }),
            ),
          ),
        ),
      ),
    )

    expect(resolved.sources[0]).toMatchObject({
      source: "WHO",
      dataset: expect.stringContaining("World Health Organization"),
    })
    expect(resolved.qualifications).toHaveLength(2)
    expect(summarize(resolved).qualifications).toEqual(resolved.qualifications)
  }).pipe(Effect.provide(replay)),
)
