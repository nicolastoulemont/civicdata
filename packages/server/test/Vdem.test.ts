import { D1Client } from "@effect/sql-d1"
import { beforeEach, expect, it } from "@effect/vitest"
import { Qualification, Trend, Year } from "@openfacts/domain"
import { reset } from "cloudflare:test"
import { DateTime, Effect, Layer, Result, Schema, Stream } from "effect"
import { SqlClient } from "effect/sql"

import rows from "../../../docs/research/vdem/records.json" with { type: "json" }
import { tables } from "../src/Catalog.ts"
import { Step } from "../src/CatalogBuild.ts"
import { Directions } from "../src/Directions.ts"
import { Faostat } from "../src/Faostat.ts"
import { Gather } from "../src/Gather.ts"
import { Ilostat } from "../src/Ilostat.ts"
import { Insee } from "../src/Insee.ts"
import { Releases } from "../src/Releases.ts"
import { Resolver } from "../src/Resolver.ts"
import { Sdmx } from "../src/Sdmx.ts"
import { Sources } from "../src/Sources.ts"
import { Outcome, Store, Stored } from "../src/Store.ts"
import { summarize } from "../src/Summary.ts"
import { polyarchy, Vdem, VdemArchive } from "../src/Vdem.ts"
import { Who } from "../src/Who.ts"
import { WorldBank } from "../src/WorldBank.ts"
import { offline } from "./fakes.ts"
import { bucket, seriesDb } from "./series.ts"

beforeEach(() => reset())

const { indicator, record, version } = polyarchy
const raw = rows.find((row) => row.country_text_id === "FRA" && row.year === 2025)

if (raw === undefined) throw new Error("Official fixture absent")

it.effect("decodes published estimates and rejects missing, inverted or out-of-scale bounds", () =>
  Effect.gen(function* () {
    const parsed = yield* record(raw)
    expect(parsed?.observations[0]?.value).toBe(0.865)
    expect(parsed?.qualifications[0]).toMatchObject({
      interval: { lower: 0.828, upper: 0.914, level: 0.68, method: "HPD" },
    })

    for (const delta of [
      { v2x_polyarchy_codelow: null },
      { v2x_polyarchy_codehigh: 0.7 },
      { v2x_polyarchy_codelow: -0.1 },
      { v2x_polyarchy: null },
      { year: 2025.5 },
      { country_id: 76, country_name: "Algeria" },
    ])
      expect(Result.isFailure(yield* record({ ...raw, ...delta }).pipe(Effect.result))).toBe(true)

    const missing = yield* record({
      ...raw,
      v2x_polyarchy: null,
      v2x_polyarchy_codelow: null,
      v2x_polyarchy_codehigh: null,
    })

    expect(missing?.observations).toEqual([])
    expect(missing?.qualifications[0]?.missing).toBe(true)
    expect(yield* record({ ...raw, country_id: 137, country_text_id: "DDR" })).toBeUndefined()
    expect(yield* record({ ...raw, year: 1990 })).toBeUndefined()
    expect(
      Schema.is(Qualification)({
        ...parsed?.qualifications[0],
        interval: { lower: 0, upper: 1, level: 0.95 },
      }),
    ).toBe(false)
  }),
)

it.effect(
  "discovers the reviewed coverage and reads nothing from the publisher on a chart miss",
  () =>
    Effect.gen(function* () {
      const adapter = yield* Vdem
      expect((yield* adapter.list).map((entry) => entry.indicator)).toEqual([indicator])
      expect(yield* Stream.runCollect(adapter.discovery?.outlines ?? Stream.empty)).toMatchObject([
        { countries: ["FRA", "SWE"], years: { first: 1991, last: 2025 } },
      ])

      expect(adapter.bulk).toBeUndefined()
      expect(adapter.coherent).toBe(true)

      const sources = Sources.of({
        "World Bank": adapter,
        Eurostat: adapter,
        OECD: adapter,
        "V-Dem": adapter,
      })

      const reads = yield* Sources.pipe(
        Effect.provide(Sources.stored.pipe(Layer.provide(Releases.layer))),
        Effect.provideService(Sources, sources),
        Effect.provide(
          Layer.merge(
            Store.r2(bucket().bucket),
            D1Client.layer({ db: seriesDb }).pipe(Layer.orDie),
          ),
        ),
      )

      const target = yield* Sources.get(reads, indicator)
      expect(
        yield* target
          .fetch({
            indicator,
            dimensions: {},
            countries: ["FRA"],
            from: Year.make(2025),
            to: Year.make(2025),
          })
          .pipe(Effect.result),
      ).toMatchObject({ failure: { source: "V-Dem", reason: "NotStored" } })

      return undefined
    }).pipe(Effect.provide(Vdem.layer)),
)

it.effect(
  "gathers one coherent pinned asset, skips completed assets, and retains filtered intervals through resolver/tools",
  () =>
    Effect.gen(function* () {
      let reads = 0
      const parsed = yield* Effect.forEach(rows, record)
      const observations = parsed.flatMap((row) => row?.observations ?? [])
      const qualifications = parsed.flatMap((row) => row?.qualifications ?? [])

      const stored = Stored.make({
        indicator: { id: indicator, name: polyarchy.name, definition: polyarchy.definition },
        dataset: polyarchy.dataset,
        version,
        dimensions: {},
        retrievedAt: DateTime.makeUnsafe("2026-11-11T12:00:00Z"),
        observations,
        qualifications,
      })

      expect(Schema.is(Stored)({ ...stored, version: "another-release" })).toBe(false)

      const source = yield* Vdem.pipe(
        Effect.provide(Vdem.layer),
        Effect.provideService(
          VdemArchive,
          VdemArchive.of({
            read: Stream.suspend(() => {
              reads += 1

              return Stream.make(stored)
            }),
          }),
        ),
      )

      expect(
        yield* source.bulk?.release?.(yield* source.list) ?? Effect.die("Missing local release"),
      ).toEqual(polyarchy.release)

      const registered = Sources.of({
        "World Bank": source,
        Eurostat: source,
        OECD: source,
        "V-Dem": source,
      })

      yield* Effect.gen(function* () {
        yield* tables
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO catalog_current (source, generation) VALUES ('V-Dem', 1)`
        yield* sql`INSERT INTO catalog (source, generation, indicator, name, definition) VALUES ('V-Dem', 1, ${indicator}, 'Electoral democracy', 'Estimate')`
        yield* Gather.run("V-Dem").pipe(Effect.provide(Layer.merge(Gather.layer, Step.immediate)))
        yield* Gather.run("V-Dem").pipe(Effect.provide(Layer.merge(Gather.layer, Step.immediate)))
        expect(reads).toBe(1)

        const sources = yield* Sources.pipe(
          Effect.provide(Sources.stored.pipe(Layer.provide(Releases.layer))),
        )

        const resolver = yield* Resolver.pipe(
          Effect.provide(Resolver.layer),
          Effect.provideService(Sources, sources),
          Effect.provide(Directions.listed),
        )

        const view = Trend.make({
          indicator,
          countries: ["FRA"],
          from: Year.make(2025),
          to: Year.make(2025),
        })

        const resolved = yield* resolver.resolve(view)
        expect(resolved.qualifications).toHaveLength(1)
        expect(summarize(resolved).qualifications).toEqual(resolved.qualifications)
        expect(resolved.sources[0].dataset).toContain("CC BY-SA 4.0")
        expect(
          yield* resolver.resolve({ ...view, transform: "Growth" }).pipe(Effect.result),
        ).toMatchObject({ failure: { indicator, transform: "Growth" } })
      }).pipe(
        Effect.provideService(Sources, registered),
        Effect.provide(
          Layer.merge(
            Store.r2(bucket().bucket),
            D1Client.layer({ db: seriesDb }).pipe(Layer.orDie),
          ),
        ),
      )
    }),
)

it.effect("stores a bounds-only revision and retains the revised bounds on read", () =>
  Effect.gen(function* () {
    const first = yield* record(raw)
    const revised = yield* record({ ...raw, v2x_polyarchy_codehigh: 0.915 })

    if (first === undefined || revised === undefined) return yield* Effect.die("Absent fixture")
    const store = yield* Store

    const metadata = {
      indicator: { id: indicator, name: polyarchy.name, definition: polyarchy.definition },
      dataset: polyarchy.dataset,
      version,
      retrievedAt: DateTime.makeUnsafe("2026-11-11T12:00:00Z"),
    }

    const initial = yield* Stream.runCollect(
      store.write(indicator, Stream.make({ ...metadata, ...first })),
    )

    const changed = yield* Stream.runCollect(
      store.write(indicator, Stream.make({ ...metadata, ...revised })),
    )

    expect(initial[0]?.outcome).toEqual(Outcome.Stored())
    expect(changed[0]?.outcome).toEqual(Outcome.Stored())
    const read = yield* store.read({ indicator, dimensions: {} })
    expect(read).toMatchObject({ value: { qualifications: [{ interval: { upper: 0.915 } }] } })

    return undefined
  }).pipe(Effect.provide(Store.r2(bucket().bucket))),
)

it.effect("routes V-Dem through the real registry alongside all existing publishers", () =>
  Effect.gen(function* () {
    const sources = yield* Sources
    expect(Object.keys(sources).toSorted()).toEqual(
      ["World Bank", "Eurostat", "OECD", "INSEE", "ILOSTAT", "FAOSTAT", "V-Dem", "WHO"].toSorted(),
    )
    const source = yield* Sources.get(sources, indicator)
    expect((yield* source.describe(indicator)).indicator.id).toBe(indicator)
  }).pipe(
    Effect.provide(
      Sources.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Vdem.layer,
            Who.layer,
            Faostat.layer,
            Ilostat.layer,
            Insee.layer,
            Sdmx.layer,
            WorldBank.layer,
          ),
        ),
        Layer.provide(offline),
      ),
    ),
  ),
)
