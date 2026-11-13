import { beforeEach, describe, expect, it } from "@effect/vitest"
import { Failure, Year } from "@repo/domain"
import { reset } from "cloudflare:test"
import { DateTime, Effect, Fiber, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"

import toc from "../../../docs/research/faostat/manifest.json?raw"
import raw from "../../../docs/research/faostat/record.json" with { type: "json" }
import { Step } from "../src/CatalogBuild.ts"
import { asti, FaostatArchive } from "../src/Faostat.ts"
import { Gather, GatherFailed } from "../src/Gather.ts"
import { Sources } from "../src/Sources.ts"
import { build, catalogOver, entry, listings } from "./catalog.ts"
import { http, steps } from "./fakes.ts"
import {
  bucket,
  bulk,
  catalogOf,
  catalogue,
  charts,
  gathered,
  seriesDb,
  ledgerRows,
  gatherOver,
  held,
  indicators,
  publishing,
  recorded,
  serving,
} from "./series.ts"

// Every test starts from empty bindings: the test Worker's D1 database and
// buckets are shared by the file's tests.
beforeEach(() => reset())

const run = Gather.run().pipe(Effect.provide(Step.immediate))

// Runs `effect` while the test clock moves a second for each live
// millisecond, so its retries wait and its timeouts end.
const passing = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect)

    while (fiber.pollUnsafe() === undefined) {
      yield* TestClock.adjust("1 second")
      yield* TestClock.withLive(Effect.sleep("1 millis"))
    }

    return yield* Fiber.join(fiber)
  })

// What the ledger recorded for an asset's last failure, and how many runs
// in a row failed it.
const failure = (asset: string) =>
  Effect.promise(() =>
    seriesDb
      .prepare(
        "SELECT json_extract(state, '$.reason') AS reason, json_extract(state, '$.failures') AS failures FROM asset_gathered WHERE asset = ?",
      )
      .bind(asset)
      .first<{ reason: string; failures: number }>(),
  ).pipe(
    Effect.map((row) => ({ reason: JSON.parse(row?.reason ?? "null"), failures: row?.failures })),
  )

// Spain's population since 2020, as charts read it.
const spain = Effect.fn(function* (codes: ReturnType<typeof indicators>) {
  const sources = yield* Sources

  return yield* sources["World Bank"].fetch({
    indicator: codes.population,
    dimensions: {},
    countries: ["ESP"],
    from: Year.make(2020),
    to: Year.make(2025),
  })
})

describe("Gather", () => {
  it.effect("stores every catalog indicator when the World Bank publishes a new release", () => {
    const codes = indicators("NEW")
    const source = serving(publishing(codes))
    const store = bucket()

    return Effect.gen(function* () {
      yield* catalogue(catalogOf(codes))
      yield* run.pipe(Effect.provide(gatherOver(source.layer, store.bucket)))

      // The release, then one request per indicator.
      expect(source.requests()).toBe(3)
      expect(store.puts()).toBe(2)
      expect(yield* gathered).toBe("2026-10-08")

      const asked = source.requests()
      const series = yield* spain(codes).pipe(Effect.provide(charts(source.layer, store.bucket)))

      expect(source.requests()).toBe(asked)
      expect(series.observations).toHaveLength(6)
    })
  })

  it.effect("stops after one request when the release has not moved", () => {
    const codes = indicators("SAME")
    const source = serving(publishing(codes))
    const store = bucket()
    const gather = gatherOver(source.layer, store.bucket)

    return Effect.gen(function* () {
      yield* catalogue(catalogOf(codes))
      yield* run.pipe(Effect.provide(gather))

      const [asked, written] = [source.requests(), store.puts()]

      yield* run.pipe(Effect.provide(gather))

      expect(source.requests() - asked).toBe(1)
      expect(store.puts()).toBe(written)
    })
  })

  it.effect("writes nothing when a new release brings the same values", () => {
    const codes = indicators("REPEAT")
    const published = publishing(codes)
    const source = serving(published)
    const store = bucket()
    const gather = gatherOver(source.layer, store.bucket)

    return Effect.gen(function* () {
      yield* catalogue(catalogOf(codes))
      yield* run.pipe(Effect.provide(gather))

      const first = yield* spain(codes).pipe(Effect.provide(charts(source.layer, store.bucket)))

      published.version = "2026-12-15"
      yield* TestClock.adjust("1 day")
      yield* run.pipe(Effect.provide(gather))

      const second = yield* spain(codes).pipe(Effect.provide(charts(source.layer, store.bucket)))

      expect(store.puts()).toBe(2)
      expect(yield* gathered).toBe("2026-12-15")
      // The stored series still reports when its values were fetched.
      expect(DateTime.toEpochMillis(second.retrievedAt)).toBe(
        DateTime.toEpochMillis(first.retrievedAt),
      )
    })
  })

  it.effect("replaces a series with revised values and added country-years", () => {
    const codes = indicators("REVISE")
    const published = publishing(codes)
    const source = serving(published)
    const store = bucket()
    const gather = gatherOver(source.layer, store.bucket)

    return Effect.gen(function* () {
      published.answers.set(
        codes.population,
        bulk(recorded.population, ({ year, cell }) => (year === 2025 ? "" : cell)),
      )
      yield* catalogue(catalogOf(codes))
      yield* run.pipe(Effect.provide(gather))

      published.version = "2026-12-15"
      published.answers.set(
        codes.population,
        bulk(recorded.population, ({ country, year, cell }) =>
          country === "ESP" && year === 2020 ? "1" : cell,
        ),
      )
      yield* run.pipe(Effect.provide(gather))

      const series = yield* spain(codes).pipe(Effect.provide(charts(source.layer, store.bucket)))

      expect(store.puts()).toBe(3)
      expect(series.observations.map(({ year }) => year).toSorted((a, b) => a - b)).toEqual([
        2020, 2021, 2022, 2023, 2024, 2025,
      ])
      expect(series.observations.find(({ year }) => year === 2020)?.value).toBe(1)
    })
  })

  it.effect(
    "holds back a candidate that loses country-years, and charts keep the stored values",
    () => {
      const codes = indicators("LOSE")
      const published = publishing(codes)
      const source = serving(published)
      const store = bucket()
      const gather = gatherOver(source.layer, store.bucket)

      return Effect.gen(function* () {
        yield* catalogue(catalogOf(codes))
        yield* run.pipe(Effect.provide(gather))

        const before = yield* spain(codes).pipe(Effect.provide(charts(source.layer, store.bucket)))

        published.version = "2026-12-15"
        published.answers.set(
          codes.population,
          bulk(recorded.population, ({ country, year, cell }) =>
            country === "ESP" && year >= 2024 ? "" : cell,
          ),
        )
        yield* run.pipe(Effect.provide(gather))

        const after = yield* spain(codes).pipe(Effect.provide(charts(source.layer, store.bucket)))

        expect(after.observations).toEqual(before.observations)
        expect(store.puts()).toBe(2)
        expect(yield* held()).toEqual([
          {
            series: codes.population,
            reason: "Lost",
            lost: JSON.stringify([
              { country: "ESP", year: 2024 },
              { country: "ESP", year: 2025 },
            ]),
          },
        ])
        // A held-back series is a decision, not a failure: the release counts as gathered.
        expect(yield* gathered).toBe("2026-12-15")
      })
    },
  )

  it.effect("holds back an empty answer and keeps the stored series", () => {
    const codes = indicators("EMPTY")
    const published = publishing(codes)
    const source = serving(published)
    const store = bucket()
    const gather = gatherOver(source.layer, store.bucket)

    return Effect.gen(function* () {
      yield* catalogue(catalogOf(codes))
      yield* run.pipe(Effect.provide(gather))

      published.version = "2026-12-15"
      // The World Bank answers as it does for an indicator it does not know.
      published.answers.delete(codes.population)
      yield* run.pipe(Effect.provide(gather))

      const series = yield* spain(codes).pipe(Effect.provide(charts(source.layer, store.bucket)))

      expect(series.observations).toHaveLength(6)
      expect(yield* held()).toMatchObject([{ series: codes.population, reason: "Empty" }])
    })
  })

  it.effect(
    "records each successful entry when another fails, so the next run asks only for that entry",
    () => {
      const codes = indicators("FAIL")
      const published = publishing(codes)
      const source = serving(published)
      const store = bucket()
      const gather = gatherOver(source.layer, store.bucket)

      return Effect.gen(function* () {
        published.answers.set(codes.unemployment, "broken")
        yield* catalogue(catalogOf(codes))

        yield* run.pipe(Effect.provide(gather))
        expect(store.puts()).toBe(1)
        expect(yield* gathered).toBe("2026-10-08")

        published.answers.set(codes.unemployment, bulk(recorded.unemployment))

        const asked = source.requests()

        yield* run.pipe(Effect.provide(gather))

        expect(source.requests() - asked).toBe(2)
        expect(store.puts()).toBe(2)
        expect(yield* gathered).toBe("2026-10-08")
      })
    },
  )

  it.effect("resumes after the last step a stopped run completed", () => {
    const codes = Array.from({ length: 60 }, (_, at) => `RESUME.${String(at).padStart(2, "0")}`)

    const published = {
      version: "2026-10-08",
      answers: new Map(codes.map((code) => [code, bulk(recorded.population)])),
    }

    const source = serving(published)
    const store = bucket()
    const gather = gatherOver(source.layer, store.bucket)

    const workflow = steps(() => Effect.void, {
      lose: "gather World Bank after RESUME.49",
    })

    return Effect.gen(function* () {
      yield* catalogue(codes.map((code) => entry(code, `Indicator ${code}`)))

      const resumable = Layer.merge(workflow.layer, gather)

      yield* Gather.run().pipe(Effect.provide(resumable), Effect.flip)

      const asked = source.requests()

      yield* Gather.run().pipe(Effect.provide(resumable))

      // The last step wrote its entries before its result was lost. The ledger
      // keeps them, so even that step asks for nothing when replayed.
      expect(source.requests() - asked).toBe(0)
      expect(store.puts()).toBe(60)
      expect(yield* gathered).toBe("2026-10-08")
    })
  })

  it.effect("waits for the catalog before gathering", () => {
    const codes = indicators("WAIT")
    const source = serving(publishing(codes))
    const store = bucket()

    return Effect.gen(function* () {
      const error = yield* run.pipe(
        Effect.provide(gatherOver(source.layer, store.bucket)),
        Effect.flip,
      )

      // Its check step failed; the run names the source.
      expect(error).toEqual(new GatherFailed({ sources: ["World Bank"] }))
      expect(store.puts()).toBe(0)
      expect(yield* gathered).toBeNull()
    })
  })
  it.effect(
    "backs off after three runs with an unreadable answer, but retries a changed version or after a week",
    () => {
      const codes = indicators("BACKOFF")
      const published = publishing(codes)
      const source = serving(published)
      const store = bucket()
      const gather = gatherOver(source.layer, store.bucket)

      return Effect.gen(function* () {
        published.answers.set(codes.unemployment, "broken")
        yield* catalogue(catalogOf(codes))

        for (let day = 0; day < 3; day += 1) {
          yield* run.pipe(Effect.provide(gather))
          yield* TestClock.adjust("1 day")
        }

        const asked = source.requests()
        yield* run.pipe(Effect.provide(gather))
        expect(source.requests() - asked).toBe(1)

        const failed = yield* Effect.promise(() =>
          seriesDb
            .prepare(
              "SELECT json_extract(state, '$.failures') AS failures, json_extract(state, '$.reason') AS reason FROM asset_gathered WHERE asset = ?",
            )
            .bind(codes.unemployment)
            .first<{ failures: number; reason: string }>(),
        )

        expect(failed?.failures).toBe(3)
        expect(JSON.parse(failed?.reason ?? "")).toEqual(Failure.cases.Unreadable.make({}))

        published.version = "2026-12-15"
        yield* run.pipe(Effect.provide(gather))
        expect(source.requests() - asked).toBe(4)

        const changed = source.requests()
        yield* TestClock.adjust("6 days")
        yield* run.pipe(Effect.provide(gather))
        expect(source.requests() - changed).toBe(1)
        yield* TestClock.adjust("1 day")
        published.answers.set(codes.unemployment, bulk(recorded.unemployment))
        yield* run.pipe(Effect.provide(gather))
        expect(source.requests() - changed).toBe(3)
        expect(store.puts()).toBe(2)
      })
    },
  )

  it.effect(
    "keeps a failed entry's stored version and clears its failure history on success",
    () => {
      const codes = indicators("PREVIOUS")
      const published = publishing(codes)
      const source = serving(published)
      const store = bucket()
      const gather = gatherOver(source.layer, store.bucket)

      const state = () =>
        seriesDb
          .prepare(
            "SELECT json_extract(state, '$.stored') AS stored, json_extract(state, '$.wanted') AS wanted, json_extract(state, '$.failures') AS failures FROM asset_gathered WHERE asset = ?",
          )
          .bind(codes.unemployment)
          .first()

      return Effect.gen(function* () {
        yield* catalogue(catalogOf(codes))
        yield* run.pipe(Effect.provide(gather))
        published.version = "2026-12-15"
        published.answers.set(codes.unemployment, "broken")
        yield* run.pipe(Effect.provide(gather))
        expect(yield* Effect.promise(state)).toEqual({
          stored: "2026-10-08",
          wanted: "2026-12-15",
          failures: 1,
        })
        published.answers.set(codes.unemployment, bulk(recorded.unemployment))
        yield* run.pipe(Effect.provide(gather))
        published.version = "2027-01-15"
        published.answers.set(codes.unemployment, "broken")
        yield* run.pipe(Effect.provide(gather))
        expect(yield* Effect.promise(state)).toEqual({
          stored: "2026-12-15",
          wanted: "2027-01-15",
          failures: 1,
        })
      })
    },
  )

  it.effect("stops at five consecutive failures across steps and keeps earlier entries", () => {
    const codes = Array.from({ length: 60 }, (_, at) => `DOWN.${String(at).padStart(2, "0")}`)

    const published = {
      version: "2026-10-08",
      answers: new Map(
        codes.map((code, at) => [code, at < 48 ? bulk(recorded.population) : ("broken" as const)]),
      ),
    }

    const source = serving(published)
    const store = bucket()
    const gather = gatherOver(source.layer, store.bucket)

    return Effect.gen(function* () {
      yield* catalogue(codes.map((code) => entry(code, `Indicator ${code}`)))
      const error = yield* run.pipe(Effect.provide(gather), Effect.flip)
      expect(error).toEqual(new GatherFailed({ sources: ["World Bank"] }))
      expect(source.requests()).toBe(54)
      expect(store.puts()).toBe(48)
      expect((yield* Effect.promise(ledgerRows)).results).toHaveLength(53)

      for (const code of codes) published.answers.set(code, bulk(recorded.population))
      const asked = source.requests()
      yield* run.pipe(Effect.provide(gather))
      expect(source.requests() - asked).toBe(13)
      expect(store.puts()).toBe(60)
    })
  })

  it.effect("records a 502 or a hang as what happened, and asks again on the next run", () => {
    const codes = indicators("OUTAGE")
    const published = publishing(codes)
    const source = serving(published)
    const store = bucket()
    const gather = gatherOver(source.layer, store.bucket)

    return Effect.gen(function* () {
      published.answers.set(codes.population, { status: 502 })
      published.answers.set(codes.unemployment, "hang")
      yield* catalogue(catalogOf(codes))

      for (let day = 0; day < 3; day += 1) {
        yield* passing(run.pipe(Effect.provide(gather)))
        yield* TestClock.adjust("1 day")
      }

      expect(yield* failure(codes.population)).toEqual({
        reason: Failure.cases.ServerError.make({ status: 502 }),
        failures: 3,
      })
      expect(yield* failure(codes.unemployment)).toEqual({
        reason: Failure.cases.Timeout.make({}),
        failures: 3,
      })

      published.answers.set(codes.population, bulk(recorded.population))
      published.answers.set(codes.unemployment, bulk(recorded.unemployment))
      yield* run.pipe(Effect.provide(gather))

      expect(store.puts()).toBe(2)
    })
  })

  it.effect("backs off for a week from an indicator the World Bank refuses", () => {
    const codes = indicators("REFUSED")
    const published = publishing(codes)
    const source = serving(published)
    const store = bucket()
    const gather = gatherOver(source.layer, store.bucket)

    return Effect.gen(function* () {
      published.answers.set(codes.unemployment, { status: 404 })
      yield* catalogue(catalogOf(codes))

      for (let day = 0; day < 3; day += 1) {
        yield* run.pipe(Effect.provide(gather))
        yield* TestClock.adjust("1 day")
      }

      expect(yield* failure(codes.unemployment)).toEqual({
        reason: Failure.cases.Refused.make({ status: 404 }),
        failures: 3,
      })

      const asked = source.requests()

      yield* run.pipe(Effect.provide(gather))

      // The release only.
      expect(source.requests() - asked).toBe(1)
    })
  })

  it.effect("asks again for an asset whose failures were recorded before they had a reason", () => {
    const codes = indicators("UNCLASSIFIED")
    const source = serving(publishing(codes))
    const store = bucket()
    const gather = gatherOver(source.layer, store.bucket)

    return Effect.gen(function* () {
      yield* catalogue(catalogOf(codes))
      yield* run.pipe(Effect.provide(gather))
      const at = DateTime.formatIso(yield* DateTime.now)
      // As production recorded the World Bank's outage of 2026-11-12.
      yield* Effect.promise(() =>
        seriesDb
          .prepare(
            "UPDATE asset_gathered SET state = json_object('_tag', 'Failed', 'wanted', '2026-10-08', 'stored', NULL, 'failures', 3, 'reason', 'SourceUnavailable', 'at', ?) WHERE asset = ?",
          )
          .bind(at, codes.population)
          .run(),
      )
      const asked = source.requests()

      yield* run.pipe(Effect.provide(gather))

      // The release, then the population again.
      expect(source.requests() - asked).toBe(2)
      expect(yield* failure(codes.population)).toEqual({ reason: null, failures: null })
    })
  })

  it.effect("ends a step before Workflows' timeout while downloads are slow", () => {
    const codes = Array.from({ length: 10 }, (_, at) => `SLOW.${String(at).padStart(2, "0")}`)

    const published = {
      version: "2026-10-08",
      answers: new Map(codes.map((code) => [code, bulk(recorded.population)])),
    }

    // Each download answers 50 seconds after it is asked.
    const source = serving(published, { delay: "50 seconds" })
    const store = bucket()
    const workflow = steps()

    return Effect.gen(function* () {
      yield* catalogue(codes.map((code) => entry(code, `Indicator ${code}`)))
      yield* Gather.run().pipe(
        Effect.provide(Layer.merge(workflow.layer, gatherOver(source.layer, store.bucket))),
      )

      // A step starts assets for 3 minutes: four of them, 50 seconds each.
      expect(workflow.ran()).toEqual([
        "check World Bank",
        "gather World Bank after ",
        "gather World Bank after SLOW.03",
        "gather World Bank after SLOW.07",
      ])
      expect(store.puts()).toBe(10)
    })
  })

  it.effect("gathers the next source after five World Bank failures in a row", () => {
    const codes = Array.from({ length: 5 }, (_, at) => `STREAK.${at}`)

    const published = {
      version: "2026-10-08",
      answers: new Map(codes.map((code) => [code, "broken" as const])),
    }

    const source = serving(published)
    const store = bucket()

    const archive = Layer.succeed(
      FaostatArchive,
      FaostatArchive.of({
        read: (version) =>
          Stream.fromEffect(
            Effect.gen(function* () {
              const parsed = yield* asti.record(raw)

              if (parsed === undefined) return yield* Effect.die("The recorded row is no series")

              return {
                ...parsed,
                indicator: { id: asti.indicator, name: asti.name, definition: asti.definition },
                dataset: asti.dataset,
                version,
                retrievedAt: yield* DateTime.now,
              }
            }),
          ),
      }),
    )

    const gather = gatherOver(source.layer, store.bucket, {
      faostat: Layer.merge(
        archive,
        http(() => new Response(toc)),
      ),
    })

    return Effect.gen(function* () {
      yield* build(1).pipe(
        Effect.provide(
          catalogOver(
            listings({
              "World Bank": codes.map((code) => entry(code, `Indicator ${code}`)),
              FAOSTAT: [entry(asti.indicator, asti.name, asti.definition)],
            }),
          ),
        ),
      )

      const error = yield* run.pipe(Effect.provide(gather), Effect.flip)

      expect(error).toEqual(new GatherFailed({ sources: ["World Bank"] }))

      const faostat = yield* Effect.promise(() =>
        seriesDb
          .prepare(
            "SELECT json_extract(state, '$._tag') AS tag FROM asset_gathered WHERE scope = 'series/v2/FAOSTAT'",
          )
          .all(),
      )

      expect(faostat.results).toEqual([{ tag: "Stored" }])
    })
  })

  it.effect(
    "seeds the ledger from the old release without fetching entries, then drops series_version",
    () => {
      const codes = indicators("MIGRATE")
      const source = serving(publishing(codes))
      const store = bucket()

      return Effect.gen(function* () {
        yield* catalogue(catalogOf(codes))
        yield* Effect.promise(() =>
          seriesDb.exec(
            "CREATE TABLE series_version (scope TEXT PRIMARY KEY, version TEXT NOT NULL)",
          ),
        )
        yield* Effect.promise(() =>
          seriesDb
            .prepare("INSERT INTO series_version VALUES (?, ?)")
            .bind("series/v2/World Bank", "2026-10-08")
            .run(),
        )
        yield* run.pipe(Effect.provide(gatherOver(source.layer, store.bucket)))
        expect(source.requests()).toBe(1)
        expect(store.puts()).toBe(0)
        expect((yield* Effect.promise(ledgerRows)).results).toHaveLength(2)

        const old = yield* Effect.promise(() =>
          seriesDb.prepare("SELECT name FROM sqlite_master WHERE name = 'series_version'").first(),
        )

        expect(old).toBeNull()
      })
    },
  )

  it.effect("gathers every entry when only an older layout has ledger rows", () => {
    const codes = indicators("LAYOUT")
    const source = serving(publishing(codes))
    const store = bucket()
    const gather = gatherOver(source.layer, store.bucket)

    return Effect.gen(function* () {
      yield* catalogue(catalogOf(codes))
      yield* run.pipe(Effect.provide(gather))
      yield* Effect.promise(() =>
        seriesDb.prepare("UPDATE asset_gathered SET scope = 'series/v1/World Bank'").run(),
      )
      const asked = source.requests()
      yield* run.pipe(Effect.provide(gather))
      expect(source.requests() - asked).toBe(3)
      expect((yield* Effect.promise(ledgerRows)).results).toHaveLength(4)
    })
  })
})

it.effect("bridges deployed World Bank successes and backoff without a bulk refetch", () => {
  const codes = indicators("BRIDGE")
  const source = serving(publishing(codes))
  const store = bucket()
  const gather = gatherOver(source.layer, store.bucket)

  return Effect.gen(function* () {
    yield* catalogue(catalogOf(codes))
    yield* run.pipe(Effect.provide(gather))
    const at = DateTime.formatIso(yield* DateTime.now)
    yield* Effect.promise(() =>
      seriesDb
        .prepare(
          "UPDATE asset_gathered SET state = json_object('_tag', 'Failed', 'wanted', '2026-10-08', 'stored', 'old', 'failures', 3, 'reason', json_object('_tag', 'Refused', 'status', 404), 'at', ?) WHERE asset = ?",
        )
        .bind(at, codes.unemployment)
        .run(),
    )
    const before = (yield* Effect.promise(ledgerRows)).results
    // Recreate the deployed per-indicator schema, including its failed row.
    yield* Effect.promise(() =>
      seriesDb.exec(
        "INSERT INTO series_gathered (scope, indicator, state) SELECT scope, asset, state FROM asset_gathered; DROP TABLE asset_gathered",
      ),
    )
    const asked = source.requests()
    yield* run.pipe(Effect.provide(gather))
    yield* run.pipe(Effect.provide(gather))
    expect(source.requests() - asked).toBe(2) // version requests only
    expect((yield* Effect.promise(ledgerRows)).results).toEqual(before)
    expect(
      (yield* spain(codes).pipe(Effect.provide(charts(source.layer, store.bucket)))).observations,
    ).toHaveLength(6)
  })
})
