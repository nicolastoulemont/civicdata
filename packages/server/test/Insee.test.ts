import { describe, expect, it } from "@effect/vitest"
import {
  Dimensions,
  DimensionsMissing,
  IndicatorId,
  IndicatorNotFound,
  SourceUnavailable,
  Trend,
  Year,
} from "@openfacts/domain"
import { Effect, Layer, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"

import { Catalog } from "../src/Catalog.ts"
import { Directions } from "../src/Directions.ts"
import { Faostat } from "../src/Faostat.ts"
import { Ilostat } from "../src/Ilostat.ts"
import { Insee } from "../src/Insee.ts"
import { Resolver } from "../src/Resolver.ts"
import { Sdmx } from "../src/Sdmx.ts"
import { Sources } from "../src/Sources.ts"
import { WorldBank } from "../src/WorldBank.ts"
import { build, catalogOver, listings } from "./catalog.ts"
import { http, memory } from "./fakes.ts"
import catalog from "./fixtures/insee/catalog.json"
import page1 from "./fixtures/insee/page1.json"
import page2 from "./fixtures/insee/page2.json"
import range from "./fixtures/insee/range.json"

const indicator = IndicatorId.make("INSEE:DD_CNA_AGREGATS")

const dimensions = Schema.decodeUnknownSync(Dimensions)({
  TRANSFORMATION: "N",
  PRICES: "V",
  EXPENDITURE: "_Z",
  STO: "B1GQ",
  GEO: "2025-FRANCE-F",
  ACCOUNTING_ENTRY: "B",
  PRODUCT: "_T",
  REF_SECTOR: "S1",
  COUNTERPART_AREA: "W0",
  UNIT_MEASURE: "XDC",
  INSTR_ASSET: "_Z",
  ACTIVITY: "_T",
  REF_YEAR_PRICE: "_Z",
})

const query = {
  indicator,
  dimensions,
  countries: ["FRA"] as const,
  from: Year.make(2024),
  to: Year.make(2025),
}

const respond = (url: string) => {
  const parsed = new URL(url)

  if (parsed.pathname.includes("/catalog/")) return Response.json(catalog)

  if (parsed.pathname.includes("/range/")) return Response.json(range)

  return Response.json(parsed.searchParams.get("page") === "2" ? page2 : page1)
}

const replay = Insee.layer.pipe(Layer.provide(http(respond)))

describe("INSEE", () => {
  it.effect(
    "discovers a national annual dataset with explicit geography, units and price choices",
    () =>
      Effect.gen(function* () {
        const source = yield* Insee
        expect((yield* source.list).map((entry) => entry.indicator)).toEqual([indicator])
        const outlines = yield* Stream.runCollect(source.discovery?.outlines ?? Stream.empty)
        expect(outlines[0]?.countries).toEqual(["FRA"])
        expect(outlines[0]?.dimensions.find(({ id }) => id === "GEO")?.codes).toEqual([
          "2025-FRANCE-F",
        ])
        expect(outlines[0]?.dimensions.find(({ id }) => id === "REF_YEAR_PRICE")?.codes).toEqual([
          "_Z",
          "2020",
        ])
        expect(source.bulk).toBeUndefined()
      }).pipe(Effect.provide(replay)),
  )

  it.effect("requires every dimension and reports unknown entries", () =>
    Effect.gen(function* () {
      const source = yield* Insee
      expect(yield* source.fetch({ ...query, dimensions: {} }).pipe(Effect.flip)).toBeInstanceOf(
        DimensionsMissing,
      )
      expect(
        yield* source.describe(IndicatorId.make("INSEE:unknown")).pipe(Effect.flip),
      ).toBeInstanceOf(IndicatorNotFound)
    }).pipe(Effect.provide(replay)),
  )

  it.effect(
    "follows pagination, converts millions to base units and retains provisional flags",
    () =>
      Effect.gen(function* () {
        const answer = yield* (yield* Insee).fetch(query)
        expect(answer.observations).toHaveLength(2)
        expect(answer.observations.find(({ year }) => year === 2025)).toEqual({
          country: "FRA",
          year: 2025,
          value: 2991055900000,
          flags: ["Provisional"],
        })
        expect(answer.url).toContain("page=1")
        expect(
          (yield* (yield* Insee).fetch({ ...query, countries: ["DEU"] })).observations,
        ).toEqual([])
      }).pipe(Effect.provide(replay)),
  )

  it.effect("reports a failed dependency instead of publishing a partial page", () =>
    Effect.gen(function* () {
      expect(yield* (yield* Insee).fetch(query).pipe(Effect.flip)).toBeInstanceOf(SourceUnavailable)
    }).pipe(
      Effect.provide(
        Insee.layer.pipe(
          Layer.provide(
            http((url) =>
              new URL(url).searchParams.get("page") === "2"
                ? new Response("down", { status: 503 })
                : respond(url),
            ),
          ),
        ),
      ),
    ),
  )

  it.effect("serves cached reads with their original retrieval provenance", () => {
    let reads = 0

    return Effect.gen(function* () {
      const source = yield* Insee
      const first = yield* source.fetch(query)
      const second = yield* source.fetch(query)
      expect(second).toEqual(first)
      expect(reads).toBe(2)
    }).pipe(
      Effect.provide(
        Insee.cached.pipe(
          Layer.provide(memory().layer),
          Layer.provide(
            http((url) => {
              if (url.includes("/data/")) reads += 1

              return respond(url)
            }),
          ),
        ),
      ),
    )
  })

  it.effect("routes a real France trend through the registered resolver with source credit", () =>
    Effect.gen(function* () {
      const resolved = yield* (yield* Resolver).resolve(Trend.make(query))
      expect(resolved.observations).toHaveLength(2)
      expect(resolved.sources[0].source).toBe("INSEE")
      expect(resolved.sources[0].dataset).toContain("Source: Insee; updated 2026-08-31")
      expect(resolved.sources[0].url).toContain("api.insee.fr/melodi/data/DD_CNA_AGREGATS")
    }).pipe(
      Effect.provide(
        Resolver.layer.pipe(
          Layer.provide(Directions.listed),
          Layer.provide(Sources.layer),
          Layer.provide(
            Layer.mergeAll(Faostat.layer, Ilostat.layer, Insee.layer, WorldBank.layer, Sdmx.layer),
          ),
          Layer.provide(http(respond)),
        ),
      ),
    ),
  )

  it.effect("reuses coverage reads for a chart's narrower years", () => {
    let reads = 0

    return Effect.gen(function* () {
      yield* TestClock.setTime(new Date("2026-11-11T00:00:00Z").getTime())
      const source = yield* Insee
      const coverage = yield* source.fetch({ ...query, from: Year.make(1996), to: Year.make(2026) })
      const chart = yield* source.fetch({ ...query, from: Year.make(2025) })

      expect(coverage.observations).toHaveLength(2)
      expect(chart.observations.map(({ year }) => year)).toEqual([2025])
      expect(chart.retrievedAt).toEqual(coverage.retrievedAt)
      expect(reads).toBe(2)
    }).pipe(
      Effect.provide(
        Insee.cached.pipe(
          Layer.provide(memory().layer),
          Layer.provide(
            http((url) => {
              if (url.includes("/data/")) reads += 1

              return respond(url)
            }),
          ),
        ),
      ),
    )
  })
})

it.effect("excludes monthly and regional rows and does not mix reference-price years", () => {
  const row = page1.observations[0]

  if (row === undefined) throw new Error("recording has no observation")

  const wire = http((url) =>
    url.includes("/data/")
      ? Response.json({
          ...page1,
          paging: { isLast: true },
          observations: [
            { ...row, dimensions: { ...row.dimensions, FREQ: "M", TIME_PERIOD: "2025-01" } },
            { ...row, dimensions: { ...row.dimensions, GEO: "2025-REG-11" } },
            { ...row, attributes: { ...row.attributes, REF_YEAR_PRICE: "2020" } },
            row,
          ],
        })
      : respond(url),
  )

  return Effect.gen(function* () {
    const answer = yield* (yield* Insee).fetch(query)

    expect(answer.observations).toHaveLength(1)
  }).pipe(Effect.provide(Insee.layer.pipe(Layer.provide(wire))))
})

it.effect("fails duplicate observations rather than collapsing distinct source rows", () => {
  const wire = http((url) =>
    url.includes("/data/")
      ? Response.json({
          ...page1,
          paging: { isLast: true },
          observations: [...page1.observations, ...page1.observations],
        })
      : respond(url),
  )

  return Effect.gen(function* () {
    expect(yield* (yield* Insee).fetch(query).pipe(Effect.flip)).toBeInstanceOf(SourceUnavailable)
  }).pipe(Effect.provide(Insee.layer.pipe(Layer.provide(wire))))
})

it.effect("publishes INSEE into local discovery and keeps all-source searches working", () =>
  Effect.gen(function* () {
    const source = yield* Insee

    yield* Effect.gen(function* () {
      yield* build(10)
      const local = yield* Catalog
      const selected = yield* local.search("economic aggregates", { source: "INSEE" })
      const all = yield* local.search("economic aggregates")
      const outlines = yield* local.outlines([indicator])

      expect(selected.map(({ indicator: id }) => id)).toContain(indicator)
      expect(all.map(({ indicator: id }) => id)).toContain(indicator)
      expect(outlines.get(indicator)?.countries).toEqual(["FRA"])
    }).pipe(Effect.provide(catalogOver(listings({ INSEE: [] }), { adapters: { INSEE: source } })))
  }).pipe(Effect.provide(replay)),
)

it.effect("retries metadata after a failed request rather than caching an outage", () => {
  let attempts = 0

  const wire = http((url) => {
    if (url.includes("/catalog/")) {
      attempts += 1

      if (attempts === 1) return new Response("down", { status: 503 })
    }

    return respond(url)
  })

  return Effect.gen(function* () {
    const source = yield* Insee
    expect(yield* source.describe(indicator).pipe(Effect.flip)).toBeInstanceOf(SourceUnavailable)
    expect((yield* source.describe(indicator)).indicator.id).toBe(indicator)
  }).pipe(Effect.provide(Insee.layer.pipe(Layer.provide(wire))))
})
