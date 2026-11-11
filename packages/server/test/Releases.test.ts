import {
  Dimensions,
  identify,
  NativeId,
  Relation,
  SourceUnavailable,
  Trend,
  Year,
} from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
import { beforeEach, expect, it } from "@effect/vitest"
import { reset } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { DateTime, Effect, Layer, Schema, Stream } from "effect"

import { type Adapter, AssetId, Policy, type Release } from "../src/Adapter.ts"
import { Step, StepFailed } from "../src/CatalogBuild.ts"
import { Directions } from "../src/Directions.ts"
import { Gather } from "../src/Gather.ts"
import { Releases } from "../src/Releases.ts"
import { Resolver } from "../src/Resolver.ts"
import { Sources } from "../src/Sources.ts"
import { Store } from "../src/Store.ts"
import { build, catalogOver, entry, listings } from "./catalog.ts"
import { bucket } from "./series.ts"

beforeEach(() => reset())

const first = identify("Fixture", NativeId.make("A"))
const second = identify("Fixture", NativeId.make("B"))
const entries = [entry(first, "First"), entry(second, "Second")]
const dimensions = Schema.decodeSync(Dimensions)({ SEX: "T" })
const year = Year.make(2020)
const at = DateTime.makeUnsafe("2026-11-10T05:00:00Z")
const database = env.CATALOG_DB

if (database === undefined) throw new Error("CATALOG_DB required")

const db = D1Client.layer({ db: database }).pipe(Layer.orDie)

const trend = (indicator = first) =>
  Trend.make({ indicator, countries: ["FRA"], from: year, to: year })

type Fault =
  | "none"
  | "stream"
  | "store"
  | "activation"
  | "omit"
  | "held"
  | "foreign"
  | "duplicate"
  | "remove"
  | "members"

const fixture = () => {
  let order = 1
  let fault: Fault = "none"
  const downloads: Array<string> = []
  let during: Effect.Effect<void> = Effect.void
  let reading: Effect.Effect<void> = Effect.void
  const memory = bucket()

  const storage = Store.r2({
    ...memory.bucket,
    get: async (key) => {
      const action = reading
      reading = Effect.void
      await Effect.runPromise(action)

      return memory.bucket.get(key)
    },
    put: (key, text, options) =>
      fault === "store" && key.endsWith(second)
        ? Promise.reject(new Error("write failed"))
        : memory.bucket.put(key, text, options),
  })

  const adapter: Adapter = {
    policy: Policy.StoredOnly({ url: (_query, version) => `https://example.org/${version}` }),
    list: Effect.succeed(entries),
    describe: (indicator) =>
      Effect.succeed({
        indicator: { id: indicator, name: "Measure", definition: "" },
        dataset: "Fixture",
        retrievedAt: at,
      }),
    fetch: () => Effect.die("No API download on a chart request"),
    bulk: {
      release: () =>
        Effect.sync((): Release => ({
          order,
          version: `version-${order}`,
          assets:
            fault === "remove"
              ? [{ asset: AssetId.make(first), members: [{ indicator: first, dimensions: {} }] }]
              : [
                  { asset: AssetId.make(first), members: [{ indicator: first, dimensions: {} }] },
                  {
                    asset: AssetId.make(second),
                    members: [
                      {
                        indicator: fault === "duplicate" ? first : second,
                        dimensions: fault === "members" ? dimensions : {},
                      },
                    ],
                  },
                ],
        })),
      gather: (asset, { version }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            downloads.push(`${version}/${asset}`)

            if (String(asset) === second) yield* during

            if (fault === "stream" && String(asset) === second)
              return Stream.fail(new SourceUnavailable({ source: "Fixture" }))

            if (fault === "omit" && String(asset) === second) return Stream.empty

            const indicator =
              fault === "foreign"
                ? identify("Other", NativeId.make("A"))
                : String(asset) === first
                  ? first
                  : second

            return Stream.succeed({
              indicator,
              series: Stream.succeed({
                indicator: { id: indicator, name: "Measure", definition: "" },
                dataset: "Fixture",
                dimensions: {},
                version,
                retrievedAt: DateTime.add(at, { days: order }),
                observations:
                  fault === "held" ? [] : [{ country: "FRA" as const, year, value: order * 10 }],
              }),
            })
          }),
        ),
    },
  }

  const unused: Adapter = {
    policy: Policy.Api(),
    list: Effect.succeed([]),
    describe: adapter.describe,
    fetch: adapter.fetch,
  }

  const sources = Layer.succeed(
    Sources,
    Sources.of({ "World Bank": unused, Eurostat: unused, OECD: unused, Fixture: adapter }),
  )

  const gather = Gather.layer.pipe(
    Layer.provide(sources),
    Layer.provide(storage),
    Layer.provide(db),
  )

  const step = Layer.succeed(
    Step,
    Step.of({
      sleep: () => Effect.void,
      run: (name, effect) =>
        name.startsWith("activate") && fault === "activation"
          ? Effect.fail(new StepFailed({ step: name, cause: "publication failed" }))
          : effect.pipe(Effect.mapError((cause) => new StepFailed({ step: name, cause }))),
    }),
  )

  const run = Gather.run().pipe(Effect.provide(Layer.merge(gather, step)))

  const charts = Resolver.layer.pipe(
    Layer.provide(Sources.stored),
    Layer.provide(sources),
    Layer.provide(storage),
    Layer.provide(Releases.layer.pipe(Layer.provide(db))),
    Layer.provide(Directions.listed),
  )

  return {
    run,
    charts,
    downloads,
    set: (next: number, failure: Fault = "none") => {
      order = next
      fault = failure
    },
    during: (effect: Effect.Effect<void>) => {
      during = effect
    },
    reading: (effect: Effect.Effect<void>) => {
      reading = effect
    },
  }
}

const expectRelease = (resolver: Resolver["Service"], version: number) =>
  Effect.gen(function* () {
    for (const indicator of [first, second]) {
      const read = yield* resolver.resolve(trend(indicator))
      expect(read.observations[0]?.value).toBe(version * 10)
      expect(read.sources[0]?.url).toBe(`https://example.org/version-${version}`)
      expect(read.sources[0]?.retrievedAt).toEqual(DateTime.add(at, { days: version }))
    }
  })

for (const fault of ["stream", "store", "activation", "omit", "held", "foreign"] as const) {
  it.effect(
    `keeps a coherent release on ${fault}, resumes completed assets, and rejects replay`,
    () => {
      const source = fixture()

      return Effect.gen(function* () {
        yield* build(1).pipe(Effect.provide(catalogOver(listings({ Fixture: entries }))))
        const resolver = yield* Resolver
        expect(yield* resolver.resolve(trend()).pipe(Effect.flip)).toMatchObject({
          reason: "NotStored",
        })
        yield* source.run
        const old = yield* resolver.resolve(trend())
        source.set(2, fault)
        source.during(
          Effect.gen(function* () {
            expect(yield* resolver.resolve(trend())).toEqual(old)
          }).pipe(Effect.orDie),
        )
        yield* source.run.pipe(Effect.flip)

        yield* expectRelease(resolver, 1)

        const before = source.downloads.length
        source.set(2)
        source.during(Effect.void)
        yield* source.run
        expect(source.downloads.length - before).toBe(
          fault === "activation" ? 0 : fault === "held" || fault === "foreign" ? 2 : 1,
        )

        yield* expectRelease(resolver, 2)

        source.set(1)
        const requests = source.downloads.length
        yield* source.run
        expect(source.downloads.length).toBe(requests)
        expect((yield* resolver.resolve(trend())).observations[0]?.value).toBe(20)
      }).pipe(Effect.provide(source.charts))
    },
  )
}

it.effect("pins a relation across publication while preserving both entries' provenance", () => {
  const source = fixture()

  return Effect.gen(function* () {
    yield* build(1).pipe(Effect.provide(catalogOver(listings({ Fixture: entries }))))
    yield* source.run
    source.set(2)
    source.reading(source.run.pipe(Effect.orDie))
    const resolver = yield* Resolver

    const read = yield* resolver.resolve(
      Relation.make({ indicator: first, against: second, countries: ["FRA"], year }),
    )

    expect(read.observations[0]?.value).toBe(10)
    expect("against" in read ? read.against.observations[0]?.value : undefined).toBe(10)
    expect(read.sources.map(({ url }) => url)).toEqual([
      "https://example.org/version-1",
      "https://example.org/version-1",
    ])
    source.reading(Effect.void)
    expect((yield* resolver.resolve(trend())).observations[0]?.value).toBe(20)
  }).pipe(Effect.provide(source.charts))
})

it.effect("keeps a first fill unavailable after one complete staged asset and resumes it", () => {
  const source = fixture()

  return Effect.gen(function* () {
    yield* build(1).pipe(Effect.provide(catalogOver(listings({ Fixture: entries }))))
    source.set(1, "stream")
    const resolver = yield* Resolver

    source.during(
      Effect.gen(function* () {
        expect(yield* resolver.resolve(trend()).pipe(Effect.flip)).toMatchObject({
          reason: "NotStored",
        })
      }).pipe(Effect.orDie),
    )
    yield* source.run.pipe(Effect.flip)

    for (const indicator of [first, second]) {
      expect(yield* resolver.resolve(trend(indicator)).pipe(Effect.flip)).toMatchObject({
        reason: "NotStored",
      })
    }

    source.set(1)
    source.during(Effect.void)
    const requests = source.downloads.length
    yield* source.run
    expect(source.downloads.length - requests).toBe(1)
    expect((yield* resolver.resolve(trend())).observations[0]?.value).toBe(10)
  }).pipe(Effect.provide(source.charts))
})

for (const fault of ["duplicate", "members", "remove"] as const) {
  it.effect(`rejects ${fault} membership instead of publishing a partial release`, () => {
    const source = fixture()

    return Effect.gen(function* () {
      yield* build(1).pipe(Effect.provide(catalogOver(listings({ Fixture: entries }))))
      yield* source.run
      source.set(2, fault)
      yield* source.run.pipe(Effect.flip)
      const resolver = yield* Resolver

      for (const indicator of [first, second]) {
        const read = yield* resolver.resolve(trend(indicator))
        expect(read.observations[0]?.value).toBe(10)
        expect(read.sources[0]?.url).toBe("https://example.org/version-1")
      }
    }).pipe(Effect.provide(source.charts))
  })
}

it.effect("rejects malformed persisted manifests through the read seam", () => {
  const source = fixture()

  return Effect.gen(function* () {
    yield* build(1).pipe(Effect.provide(catalogOver(listings({ Fixture: entries }))))
    yield* source.run
    yield* Effect.promise(() =>
      database.prepare("UPDATE series_release SET manifest = '{}' WHERE source = 'Fixture'").run(),
    )
    const resolver = yield* Resolver
    expect(yield* resolver.resolve(trend()).pipe(Effect.flip)).toMatchObject({
      reason: "StoreUnavailable",
    })
  }).pipe(Effect.provide(source.charts))
})

it.effect("keeps old values when the pointer write fails and retries without downloads", () => {
  const source = fixture()

  return Effect.gen(function* () {
    yield* build(1).pipe(Effect.provide(catalogOver(listings({ Fixture: entries }))))
    yield* source.run
    yield* Effect.promise(() =>
      database.exec(
        "CREATE TRIGGER reject_release BEFORE UPDATE ON series_release BEGIN SELECT RAISE(ABORT, 'pointer write failed'); END",
      ),
    )
    source.set(2)
    yield* source.run.pipe(Effect.flip)
    const resolver = yield* Resolver
    yield* expectRelease(resolver, 1)
    yield* Effect.promise(() => database.exec("DROP TRIGGER reject_release"))
    const requests = source.downloads.length
    yield* source.run
    expect(source.downloads.length).toBe(requests)
    yield* expectRelease(resolver, 2)
  }).pipe(Effect.provide(source.charts))
})

it.effect("rejects an in-flight older ingestion after a newer publisher activates", () => {
  const source = fixture()

  return Effect.gen(function* () {
    yield* build(1).pipe(Effect.provide(catalogOver(listings({ Fixture: entries }))))
    yield* source.run
    source.set(2)
    source.during(
      Effect.gen(function* () {
        source.during(Effect.void)
        source.set(3)
        yield* source.run
      }).pipe(Effect.orDie),
    )
    yield* source.run.pipe(Effect.flip)
    const resolver = yield* Resolver
    yield* expectRelease(resolver, 3)
  }).pipe(Effect.provide(source.charts))
})
