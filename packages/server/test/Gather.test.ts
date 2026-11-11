import { Year } from "@civicdata/domain"
import { beforeEach, describe, expect, it } from "@effect/vitest"
import { reset } from "cloudflare:test"
import { DateTime, Effect, Layer } from "effect"
import { TestClock } from "effect/testing"

import { Step, StepFailed } from "../src/CatalogBuild.ts"
import { Gather, GatherFailed } from "../src/Gather.ts"
import { Sources } from "../src/Sources.ts"
import { entry } from "./catalog.ts"
import { steps } from "./fakes.ts"
import {
  bucket,
  bulk,
  catalogOf,
  catalogue,
  charts,
  gathered,
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
    "leaves the release unrecorded when an indicator fails, so the next run asks again",
    () => {
      const codes = indicators("FAIL")
      const published = publishing(codes)
      const source = serving(published)
      const store = bucket()
      const gather = gatherOver(source.layer, store.bucket)

      return Effect.gen(function* () {
        published.answers.set(codes.unemployment, "broken")
        yield* catalogue(catalogOf(codes))

        const error = yield* run.pipe(Effect.provide(gather), Effect.flip)

        expect(error).toEqual(new GatherFailed({ source: "World Bank", failed: 1 }))
        expect(store.puts()).toBe(1)
        expect(yield* gathered).toBeNull()

        published.answers.set(codes.unemployment, bulk(recorded.unemployment))

        const asked = source.requests()

        yield* run.pipe(Effect.provide(gather))

        expect(source.requests() - asked).toBe(3)
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
      lose: "gather World Bank 2026-10-08 after RESUME.49",
    })

    return Effect.gen(function* () {
      yield* catalogue(codes.map((code) => entry(code, `Indicator ${code}`)))

      const resumable = Layer.merge(workflow.layer, gather)

      yield* Gather.run().pipe(Effect.provide(resumable), Effect.flip)

      const asked = source.requests()

      yield* Gather.run().pipe(Effect.provide(resumable))

      // The check and the first 50 replay; only the last 10 are asked again.
      expect(source.requests() - asked).toBe(10)
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

      expect(error).toBeInstanceOf(StepFailed)
      expect(store.puts()).toBe(0)
      expect(yield* gathered).toBeNull()
    })
  })
})
