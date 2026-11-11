import {
  type CatalogEntry,
  Dimensions,
  IndicatorId,
  pathOf,
  type Source,
  Trend,
  Year,
} from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
import { beforeEach, describe, expect, it } from "@effect/vitest"
import { reset } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { DateTime, Effect, Layer, Option, Schema, Stream } from "effect"

import { type Adapter, Policy } from "../src/Adapter.ts"
import { Step } from "../src/CatalogBuild.ts"
import { Directions } from "../src/Directions.ts"
import { Gather } from "../src/Gather.ts"
import { Resolver } from "../src/Resolver.ts"
import type { Query } from "../src/Series.ts"
import { Sources } from "../src/Sources.ts"
import { Store } from "../src/Store.ts"
import { build, catalogOver, entry, listings } from "./catalog.ts"
import { bucket } from "./series.ts"

beforeEach(() => reset())

const flow = IndicatorId.make("OECD.TEST,DSD_MADE@DF_UP,1.0")

const sex = (code: string) => Schema.decodeSync(Dimensions)({ SEX: code })

const retrievedAt = DateTime.makeUnsafe("2026-11-10T05:00:00Z")

// A made-up source whose one catalog entry holds a series for women and one
// for men, published in one bulk release, and asked through its API for any
// other series. It notes each series its API is asked for.
const madeUp = (asked: Array<Query>): Adapter => ({
  policy: Policy.Full({
    changed: (gathered) =>
      Effect.succeed(Option.isSome(gathered) ? Option.none() : Option.some("2026-11")),
    gather: ({ indicator, name, definition }: CatalogEntry, release) =>
      Stream.fromIterable(
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
    url: (query) => `https://example.org/${pathOf(query)}?from=${query.from}&to=${query.to}`,
  }),
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
  policy: Policy.None(),
  list: Effect.succeed([]),
  describe: () => Effect.die(`${source} is not asked in these tests`),
  fetch: () => Effect.die(`${source} is not asked in these tests`),
})

// Every source but the OECD's slot, which the made-up source takes. Nothing
// outside this registry knows about it.
const registry = (asked: Array<Query>) =>
  Layer.succeed(
    Sources,
    Sources.of({
      "World Bank": unused("World Bank"),
      Eurostat: unused("Eurostat"),
      OECD: madeUp(asked),
    }),
  )

const db = env.DB

if (db === undefined) throw new Error("vitest.config.ts must bind a D1 database as DB")

const view = (code: string) =>
  Trend.make({
    indicator: flow,
    countries: ["FRA"],
    from: Year.make(2020),
    to: Year.make(2021),
    dimensions: sex(code),
  })

describe("a source that implements the contract", () => {
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
        Effect.provide(catalogOver(listings({ OECD: [entry(flow, "Made-up rate")] }))),
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
          source: "OECD",
          dataset: "Made-up statistics",
          url: `https://example.org/${flow}/SEX=F?from=2020&to=2021`,
        },
      ])

      yield* resolver.resolve(view("T"))

      expect(asked.map(pathOf)).toEqual([`${flow}/SEX=T`])
    }).pipe(Effect.provide(charts))
  })
})
