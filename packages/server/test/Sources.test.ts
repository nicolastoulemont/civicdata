import {
  Dimensions,
  identify,
  IndicatorNotFound,
  SourceUnavailable,
  NativeId,
  nativeId,
  pathOf,
  type Source,
  Trend,
  Year,
} from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
import { beforeEach, describe, expect, it } from "@effect/vitest"
import { reset } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { DateTime, Effect, Layer, Match, Schema, Stream } from "effect"
import { HttpClient } from "effect/http"

import { type Adapter, AssetId, Policy } from "../src/Adapter.ts"
import { Step } from "../src/CatalogBuild.ts"
import { Directions } from "../src/Directions.ts"
import { Gather } from "../src/Gather.ts"
import { Resolver } from "../src/Resolver.ts"
import type { Query } from "../src/Series.ts"
import { Sources } from "../src/Sources.ts"
import { Store, Stored } from "../src/Store.ts"
import { build, catalogOver, entry, listings } from "./catalog.ts"
import { http } from "./fakes.ts"
import { bucket } from "./series.ts"

beforeEach(() => reset())

const native: NativeId = NativeId.make("DSD_MADE@DF_UP")
const flow = identify("Fixture", native)

const sex = (code: string) => Schema.decodeSync(Dimensions)({ SEX: code })

const retrievedAt = DateTime.makeUnsafe("2026-11-10T05:00:00Z")

// A made-up source whose one catalog entry holds a series for women and one
// for men, published in one bulk release, and asked through its API for any
// other series. It notes each series its API is asked for.
const madeUp = (asked: Array<Query>): Adapter => ({
  policy: Policy.StoredApi({
    url: (query) =>
      `https://example.org/${nativeId(query.indicator)}/${pathOf(query).split("/")[1]}?from=${query.from}&to=${query.to}`,
  }),
  bulk: {
    changed: () => Effect.succeed([{ asset: AssetId.make("release"), version: "2026-11" }]),
    gather: (_asset, { version: release, entries }) =>
      Stream.fromIterable(entries).pipe(
        Stream.map(({ indicator, name, definition }) => ({
          indicator,
          series: Stream.fromIterable(
            (["F", "M"] as const).map((code, at) => ({
              indicator: { id: indicator, name, definition },
              dataset: "Made-up statistics",
              dimensions: sex(code),
              version: release,
              retrievedAt,
              observations: [2020, 2021].map((year) => ({
                country: "FRA" as const,
                year: Year.make(year),
                value: 10 * (at + 1) + year - 2020,
              })),
            })),
          ),
        })),
      ),
  },
  list: Effect.succeed([entry(flow, "Made-up rate")]),
  describe: (indicator) =>
    Effect.succeed({
      indicator: { id: indicator, name: "Made-up rate", definition: "" },
      dataset: "Made-up statistics",
      retrievedAt,
    }),
  fetch: (query) =>
    Effect.sync(() => asked.push(query)).pipe(
      Effect.as({ observations: [], url: "https://example.org/api", retrievedAt, dimensions: [] }),
    ),
})

const unused = (source: Source): Adapter => ({
  policy: Policy.Api(),
  list: Effect.succeed([]),
  describe: () => Effect.die(`${source} is not asked in these tests`),
  fetch: () => Effect.die(`${source} is not asked in these tests`),
})

// A fourth publisher, registered only in this test.
const registry = (asked: Array<Query>) =>
  Layer.succeed(
    Sources,
    Sources.of({
      "World Bank": unused("World Bank"),
      Eurostat: unused("Eurostat"),
      OECD: unused("OECD"),
      Fixture: madeUp(asked),
    }),
  )

// The catalog's database: the gather lists what the catalog build published
// there.
const db = env.CATALOG_DB

if (db === undefined) throw new Error("vitest.config.ts must bind a D1 database as CATALOG_DB")

const view = (code: string) =>
  Trend.make({
    indicator: flow,
    countries: ["FRA"],
    from: Year.make(2020),
    to: Year.make(2021),
    dimensions: sex(code),
  })

describe("a source that implements the contract", () => {
  it.effect("returns a missing indicator for an unregistered publisher", () =>
    Effect.gen(function* () {
      const resolver = yield* Resolver

      for (const source of ["Missing", "constructor", "toString"]) {
        const indicator = identify(source, NativeId.make("measure"))
        expect(yield* resolver.resolve({ ...view("F"), indicator }).pipe(Effect.flip)).toEqual(
          new IndicatorNotFound({ indicator }),
        )
      }
    }).pipe(
      Effect.provide(
        Resolver.layer.pipe(Layer.provide(registry([])), Layer.provide(Directions.listed)),
      ),
    ),
  )

  it.effect("is gathered by series key and charted from the store, and asked on a miss", () => {
    const asked: Array<Query> = []
    const store = bucket()
    const sources = registry(asked)

    const gather = Gather.layer.pipe(
      Layer.provide(Store.r2(store.bucket)),
      Layer.provide(sources),
      Layer.provide(D1Client.layer({ db }).pipe(Layer.orDie)),
    )

    const charts = Resolver.layer.pipe(
      Layer.provide(Sources.stored),
      Layer.provide(sources),
      Layer.provide(Store.r2(store.bucket)),
      Layer.provide(Directions.listed),
    )

    return Effect.gen(function* () {
      yield* build(1).pipe(
        Effect.provide(catalogOver(listings({ Fixture: [entry(flow, "Made-up rate")] }))),
      )
      yield* Gather.run().pipe(Effect.provide(Layer.merge(gather, Step.immediate)))

      // Both series in one pack.
      expect(store.puts()).toBe(1)

      const resolver = yield* Resolver
      const women = yield* resolver.resolve(view("F"))

      expect(asked).toEqual([])
      expect(women.observations).toEqual([
        { country: "FRA", year: 2020, value: 10 },
        { country: "FRA", year: 2021, value: 11 },
      ])
      expect(women.sources).toMatchObject([
        {
          indicator: flow,
          source: "Fixture",
          dataset: "Made-up statistics",
          url: `https://example.org/${native}/SEX=F?from=2020&to=2021`,
        },
      ])

      yield* resolver.resolve(view("T"))

      expect(asked.map(pathOf)).toEqual([`${flow}/SEX=T`])
    }).pipe(Effect.provide(charts))
  })
})

const other = identify("Fixture", NativeId.make("SECOND"))
const fileEntries = [entry(flow, "First measure"), entry(other, "Second measure")]

const file = fileEntries.map(({ indicator, name, definition }) => ({
  indicator: { id: indicator, name, definition },
  dataset: "Fixture release file",
  dimensions: {},
  version: "one",
  retrievedAt: "2026-11-10T05:00:00Z",
  observations: [{ country: "FRA", year: 2020, value: 42 }],
}))

// A finite fixture file, decoded at the wire. Production adapters must stream
// or sort on disk, rather than collect a whole asset as this tiny fixture does.
const fileSource = (options: { api?: boolean; partial?: () => boolean }, asked: Array<Query>) =>
  Layer.effect(
    Sources,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      const base = madeUp(asked)

      const adapter: Adapter = {
        ...base,
        policy: options.api
          ? Policy.StoredApi({ url: () => "https://example.org/file" })
          : Policy.StoredOnly({
              url: (_query, version) => `https://example.org/releases/${version}`,
            }),
        bulk: {
          changed: () => Effect.succeed([{ asset: AssetId.make("country-FRA"), version: "one" }]),
          gather: () =>
            Stream.unwrap(
              client.get("https://example.org/file").pipe(
                Effect.flatMap((response) => response.json),
                Effect.flatMap(
                  Schema.decodeUnknownEffect(Schema.Array(Schema.toCodecJson(Stored))),
                ),
                Effect.mapError(() => new SourceUnavailable({ source: "Fixture" })),
                Effect.map((rows) =>
                  Stream.fromIterable(options.api ? rows.slice(0, 1) : rows).pipe(
                    Stream.map((row, index) => ({
                      indicator: row.indicator.id,
                      series: Stream.succeed(row).pipe(
                        Stream.concat(
                          options.partial?.() && index === 1
                            ? Stream.fail(new SourceUnavailable({ source: "Fixture" }))
                            : Stream.empty,
                        ),
                      ),
                    })),
                  ),
                ),
              ),
            ),
        },
      }

      return Sources.of({
        "World Bank": unused("World Bank"),
        Eurostat: unused("Eurostat"),
        OECD: unused("OECD"),
        Fixture: adapter,
      })
    }),
  )

const fileView = (indicator = flow) => ({ ...view("F"), indicator, dimensions: {} })

for (const failure of ["none", "partial", "store"] as const) {
  it.effect(
    `fetches one file for two entries and retries only incomplete assets: ${failure}`,
    () => {
      let requests = 0
      let failing = failure !== "none"
      const asked: Array<Query> = []
      const store = bucket()

      const sources = fileSource({ partial: () => failing && failure === "partial" }, asked).pipe(
        Layer.provide(
          http(() => {
            requests += 1

            return Response.json(file)
          }),
        ),
      )

      const storage = Store.r2({
        ...store.bucket,
        put: (key, value, options) =>
          failing && failure === "store" && key.endsWith(String(other))
            ? Promise.reject(new Error("bucket unavailable"))
            : store.bucket.put(key, value, options),
      })

      const gather = Gather.layer.pipe(
        Layer.provide(storage),
        Layer.provide(sources),
        Layer.provide(D1Client.layer({ db }).pipe(Layer.orDie)),
      )

      const charts = Resolver.layer.pipe(
        Layer.provide(Sources.stored),
        Layer.provide(sources),
        Layer.provide(storage),
        Layer.provide(Directions.listed),
      )

      return Effect.gen(function* () {
        yield* build(1).pipe(Effect.provide(catalogOver(listings({ Fixture: fileEntries }))))
        yield* Gather.run().pipe(Effect.provide(Layer.merge(gather, Step.immediate)))
        expect(requests).toBe(1)
        const resolver = yield* Resolver
        expect((yield* resolver.resolve(fileView())).observations[0]?.value).toBe(42)

        if (failing) {
          expect(yield* resolver.resolve(fileView(other)).pipe(Effect.flip)).toEqual(
            new SourceUnavailable({ source: "Fixture", reason: "NotStored" }),
          )
          failing = false
          yield* Gather.run().pipe(Effect.provide(Layer.merge(gather, Step.immediate)))
          expect(requests).toBe(2)
        }

        const second = yield* resolver.resolve(fileView(other))
        expect(second.observations[0]?.value).toBe(42)
        expect(second.sources[0]?.url).toBe("https://example.org/releases/one")
        const fetched = requests
        yield* Gather.run().pipe(Effect.provide(Layer.merge(gather, Step.immediate)))
        expect(requests).toBe(fetched)
        expect(asked).toEqual([])
      }).pipe(Effect.provide(charts))
    },
  )
}

it.effect(
  "reads a selected mirror from the store and leaves the rest searchable through the API",
  () => {
    const asked: Array<Query> = []
    let requests = 0
    const store = bucket()

    const sources = fileSource({ api: true }, asked).pipe(
      Layer.provide(
        http(() => {
          requests += 1

          return Response.json(file)
        }),
      ),
    )

    const gather = Gather.layer.pipe(
      Layer.provide(Store.r2(store.bucket)),
      Layer.provide(sources),
      Layer.provide(D1Client.layer({ db }).pipe(Layer.orDie)),
    )

    return Effect.gen(function* () {
      yield* build(1).pipe(Effect.provide(catalogOver(listings({ Fixture: fileEntries }))))
      yield* Gather.run().pipe(Effect.provide(Layer.merge(gather, Step.immediate)))
      const adapters = yield* Sources
      const query = { ...fileView(), dimensions: {} }
      expect(
        (yield* (yield* Sources.get(adapters, flow)).fetch(query)).observations[0]?.value,
      ).toBe(42)
      yield* (yield* Sources.get(adapters, flow)).fetch({ ...query, indicator: other })
      expect(asked.map(({ indicator }) => indicator)).toEqual([other])
      expect(requests).toBe(1)
    }).pipe(
      Effect.provide(
        Sources.stored.pipe(Layer.provide(sources), Layer.provide(Store.r2(store.bucket))),
      ),
    )
  },
)

for (const failure of ["NotStored", "StoreUnavailable"] as const) {
  it.effect(`reports ${failure} on a stored-only read without any source request`, () => {
    let requests = 0
    const asked: Array<Query> = []
    const memory = bucket()

    const storage = Store.r2({
      ...memory.bucket,
      get: (key) =>
        failure === "StoreUnavailable"
          ? Promise.reject(new Error("bucket offline"))
          : memory.bucket.get(key),
    })

    const sources = fileSource({}, asked).pipe(
      Layer.provide(
        http(() => {
          requests += 1

          return Response.json(file)
        }),
      ),
    )

    return Effect.gen(function* () {
      const resolver = yield* Resolver
      expect(yield* resolver.resolve(fileView()).pipe(Effect.flip)).toEqual(
        new SourceUnavailable({ source: "Fixture", reason: failure }),
      )
      expect(requests).toBe(0)
      expect(asked).toEqual([])
    }).pipe(
      Effect.provide(
        Resolver.layer.pipe(
          Layer.provide(Sources.stored),
          Layer.provide(sources),
          Layer.provide(storage),
          Layer.provide(Directions.listed),
        ),
      ),
    )
  })
}

for (const fault of ["order", "source", "version", "empty"] as const) {
  it.effect(`rejects ${fault} output without completing the asset`, () => {
    let requests = 0
    const memory = bucket()

    const rows = Match.value(fault).pipe(
      Match.when("order", () => file.toReversed()),
      Match.when("source", () =>
        file.map((row) =>
          Object.assign({}, row, {
            indicator: Object.assign({}, row.indicator, {
              id: identify("Foreign", NativeId.make("measure")),
            }),
          }),
        ),
      ),
      Match.when("version", () => file.map((row) => Object.assign({}, row, { version: "wrong" }))),
      Match.when("empty", () => []),
      Match.exhaustive,
    )

    const sources = fileSource({}, []).pipe(
      Layer.provide(
        http(() => {
          requests += 1

          return Response.json(rows)
        }),
      ),
    )

    const gather = Gather.layer.pipe(
      Layer.provide(Store.r2(memory.bucket)),
      Layer.provide(sources),
      Layer.provide(D1Client.layer({ db }).pipe(Layer.orDie)),
    )

    return Effect.gen(function* () {
      yield* build(1).pipe(Effect.provide(catalogOver(listings({ Fixture: fileEntries }))))
      yield* Gather.run().pipe(Effect.provide(Layer.merge(gather, Step.immediate)))

      const state = yield* Effect.promise(() =>
        db
          .prepare(
            "SELECT json_extract(state, '$._tag') AS tag FROM asset_gathered WHERE scope = 'series/v2/Fixture'",
          )
          .first("tag"),
      )

      expect(state).toBe("Failed")
      yield* Gather.run().pipe(Effect.provide(Layer.merge(gather, Step.immediate)))
      expect(requests).toBe(2)
    })
  })
}
