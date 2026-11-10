import { Dimensions, IndicatorId, Year } from "@civicdata/domain"
import { beforeEach, describe, expect, it } from "@effect/vitest"
import { reset } from "cloudflare:test"
import { DateTime, Effect, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"

import { Step, StepFailed } from "../src/CatalogBuild.ts"
import { Gather, GatherFailed } from "../src/Gather.ts"
import { Sdmx } from "../src/Sdmx.ts"
import { WorldBank } from "../src/WorldBank.ts"
import { entry } from "./catalog.ts"
import { steps } from "./fakes.ts"
import {
  bucket,
  bulk,
  catalogOf,
  catalogue,
  charts,
  contents,
  eurostatCharts,
  eurostatRecorded,
  file,
  gathered,
  gatheredOf,
  gatherOver,
  held,
  indicators,
  publishing,
  recorded,
  serving,
  skipped,
} from "./series.ts"

// Every test starts from empty bindings: the test Worker's D1 database and
// buckets are shared by the file's tests.
beforeEach(() => reset())

const run = Gather.run().pipe(Effect.provide(Step.immediate))

// Spain's population since 2020, as charts read it.
const spain = Effect.fn(function* (codes: ReturnType<typeof indicators>) {
  const chart = yield* WorldBank

  return yield* chart.observations({
    indicator: codes.population,
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
            series: `series/v1/world-bank/${codes.population}`,
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
      expect(yield* held()).toMatchObject([
        { series: `series/v1/world-bank/${codes.population}`, reason: "Empty" },
      ])
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

        expect(error).toEqual(new GatherFailed({ sources: ["World Bank"], failed: 1 }))
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

// Each test names its own datasets, such as ESTAT,SAME_UNE,1.0, so the
// series one test stores never meet another's in the shared bucket.
const datasets = (prefix: string) => ({
  unemployment: IndicatorId.make(`ESTAT,${prefix}_UNE,1.0`),
  quarterly: IndicatorId.make(`ESTAT,${prefix}_BOP,1.0`),
  regional: IndicatorId.make(`ESTAT,${prefix}_REG,1.0`),
  large: IndicatorId.make(`ESTAT,${prefix}_BIG,1.0`),
  gone: IndicatorId.make(`ESTAT,${prefix}_OLD,1.0`),
})

const fileOf = (id: IndicatorId) => id.split(",")[1] ?? ""

// The World Bank's two indicators, and Eurostat publishing unemployment by
// sex and age, last updated on 6 November 2026.
const publishingEurostat = (prefix: string) => {
  const codes = datasets(prefix)
  const published = publishing(indicators(`ESTAT-${prefix}`))

  published.contents = contents([{ id: codes.unemployment, updated: "06.11.2026" }])
  published.files = new Map([[fileOf(codes.unemployment), file(eurostatRecorded.unemployment)]])

  return { codes, published }
}

const catalogueEurostat = (prefix: string, ids: ReadonlyArray<IndicatorId>) =>
  catalogue(
    catalogOf(indicators(`ESTAT-${prefix}`)),
    ids.map((id) => entry(id, "Unemployment by sex and age - annual data")),
  )

// Runs on 10 November 2026, after the releases the tests publish.
const gatherNow = TestClock.setTime(Date.parse("2026-11-10T05:00:00Z"))

const youngWomen = Schema.decodeSync(Dimensions)({ age: "Y15-24", unit: "PC_ACT", sex: "F" })

const everyone = Schema.decodeSync(Dimensions)({ age: "Y15-74", unit: "PC_ACT", sex: "T" })

// Unemployment of young women in France since 2020, as charts read it.
const france = Effect.fn(function* (indicator: IndicatorId, dimensions = youngWomen) {
  const chart = yield* Sdmx

  return yield* chart.observations({
    indicator,
    countries: ["FRA"],
    from: Year.make(2020),
    to: Year.make(2025),
    dimensions,
  })
})

describe("Gather from Eurostat", () => {
  it.effect("stores one series per combination of a dataset's dimensions", () => {
    const { codes, published } = publishingEurostat("NEW")
    const source = serving(published)
    const store = bucket()

    return Effect.gen(function* () {
      yield* gatherNow
      yield* catalogueEurostat("NEW", [codes.unemployment])
      yield* run.pipe(Effect.provide(gatherOver(source.layer, store.bucket)))

      // Women, men and everyone, aged 15 to 24.
      expect(source.downloads()).toBe(1)
      expect(store.puts("eurostat")).toBe(3)
      expect(yield* gatheredOf(codes.unemployment)).toBe("2026-11-06")

      const series = yield* france(codes.unemployment).pipe(
        Effect.provide(eurostatCharts(source.layer, store.bucket)),
      )

      // Read from the store: Eurostat is asked for the dataset's dimensions
      // only, as it is for any chart.
      expect(source.queries()).toBe(0)
      expect(series.observations).toHaveLength(6)
      expect(series.observations.at(-1)).toEqual({ country: "FRA", year: 2025, value: 19.6 })
      expect(series.retrievedAt).toEqual(DateTime.makeUnsafe("2026-11-10T05:00:00Z"))
      expect(series.url).toContain(`/${fileOf(codes.unemployment)}/1.0/*?c[geo]=FR&c[freq]=A`)
      expect(series.url).toContain("&c[age]=Y15-24&c[unit]=PC_ACT&c[sex]=F&")
    })
  })

  it.effect("asks Eurostat for a combination it has not stored", () => {
    const { codes, published } = publishingEurostat("MISS")
    const source = serving(published)
    const store = bucket()

    return Effect.gen(function* () {
      yield* gatherNow
      yield* catalogueEurostat("MISS", [codes.unemployment])
      yield* run.pipe(Effect.provide(gatherOver(source.layer, store.bucket)))

      // The run stored 15 to 24 year olds only.
      const series = yield* france(codes.unemployment, everyone).pipe(
        Effect.provide(eurostatCharts(source.layer, store.bucket)),
      )

      expect(source.queries()).toBe(1)
      expect(series.observations).toHaveLength(3)
    })
  })

  it.effect("downloads nothing for a dataset whose release has not moved", () => {
    const { codes, published } = publishingEurostat("SAME")
    const source = serving(published)
    const store = bucket()
    const gather = gatherOver(source.layer, store.bucket)

    return Effect.gen(function* () {
      yield* gatherNow
      yield* catalogueEurostat("SAME", [codes.unemployment])
      yield* run.pipe(Effect.provide(gather))
      yield* run.pipe(Effect.provide(gather))

      expect(source.downloads()).toBe(1)
      expect(store.puts("eurostat")).toBe(3)
    })
  })

  it.effect("writes nothing when a new release holds the same values", () => {
    const { codes, published } = publishingEurostat("REDO")
    const source = serving(published)
    const store = bucket()
    const gather = gatherOver(source.layer, store.bucket)

    return Effect.gen(function* () {
      yield* gatherNow
      yield* catalogueEurostat("REDO", [codes.unemployment])
      yield* run.pipe(Effect.provide(gather))

      published.contents = contents([{ id: codes.unemployment, updated: "07.11.2026" }])
      yield* run.pipe(Effect.provide(gather))

      expect(source.downloads()).toBe(2)
      expect(store.puts("eurostat")).toBe(3)
      expect(yield* gatheredOf(codes.unemployment)).toBe("2026-11-07")
    })
  })

  it.effect("holds back a series that loses country-years and keeps serving the stored one", () => {
    const { codes, published } = publishingEurostat("LOSE")
    const source = serving(published)
    const store = bucket()
    const gather = gatherOver(source.layer, store.bucket)

    return Effect.gen(function* () {
      yield* gatherNow
      yield* catalogueEurostat("LOSE", [codes.unemployment])
      yield* run.pipe(Effect.provide(gather))

      // France's young women lose 2024 and 2025; the men's values change.
      published.contents = contents([{ id: codes.unemployment, updated: "07.11.2026" }])
      published.files?.set(
        fileOf(codes.unemployment),
        file(eurostatRecorded.unemployment, ({ keys, year, cell }) => {
          if (keys[3] === "F" && keys[4] === "FR" && year >= 2024) return ": "

          if (keys[3] === "M" && cell.trim() !== ":") return "1.0 "

          return cell
        }),
      )
      yield* run.pipe(Effect.provide(gather))

      expect(store.puts("eurostat")).toBe(4)
      expect(yield* held()).toEqual([
        {
          series: `series/v1/eurostat/${codes.unemployment}/age=Y15-24,sex=F,unit=PC_ACT`,
          reason: "Lost",
          lost: JSON.stringify([
            { country: "FRA", year: 2024 },
            { country: "FRA", year: 2025 },
          ]),
        },
      ])

      const series = yield* france(codes.unemployment).pipe(
        Effect.provide(eurostatCharts(source.layer, store.bucket)),
      )

      expect(series.observations).toHaveLength(6)
    })
  })

  it.effect("skips the datasets it cannot store and records why", () => {
    const { codes, published } = publishingEurostat("SKIP")
    const source = serving(published)
    const store = bucket()
    const gather = gatherOver(source.layer, store.bucket)

    return Effect.gen(function* () {
      published.contents = contents([
        { id: codes.quarterly, updated: "28.10.2026" },
        { id: codes.regional, updated: "06.11.2026" },
        { id: codes.large, updated: "06.11.2026", values: 30_000_000 },
        { id: codes.gone, updated: "06.11.2026" },
      ])
      published.files?.set(fileOf(codes.quarterly), file(eurostatRecorded.quarterly))
      // The EU's values alone: no country we chart.
      published.files?.set(
        fileOf(codes.regional),
        file(
          eurostatRecorded.unemployment
            .split("\n")
            .filter((line, at) => at === 0 || line.includes(",EU27_2020\t"))
            .join("\n"),
        ),
      )

      yield* gatherNow
      yield* catalogueEurostat("SKIP", [codes.quarterly, codes.regional, codes.large, codes.gone])
      yield* run.pipe(Effect.provide(gather))

      expect(yield* skipped()).toEqual([
        { scope: codes.large, reason: "TooLarge" },
        { scope: codes.quarterly, reason: "NoAnnual" },
        { scope: codes.gone, reason: "NotFound" },
        { scope: codes.regional, reason: "NoCountries" },
      ])
      // The large dataset is skipped without downloading it.
      expect(source.downloads()).toBe(3)
      expect(store.puts("eurostat")).toBe(0)

      // Until their release moves, the next run asks for none of them.
      yield* run.pipe(Effect.provide(gather))

      expect(source.downloads()).toBe(3)
    })
  })

  it.effect(
    "leaves a failed dataset's release unrecorded, and the next run gathers that one only",
    () => {
      const { codes, published } = publishingEurostat("FAIL")
      const source = serving(published)
      const store = bucket()
      const gather = gatherOver(source.layer, store.bucket)

      return Effect.gen(function* () {
        published.contents = contents([
          { id: codes.unemployment, updated: "06.11.2026" },
          { id: codes.regional, updated: "06.11.2026" },
        ])
        published.files?.set(fileOf(codes.regional), "broken")

        yield* gatherNow
        yield* catalogueEurostat("FAIL", [codes.unemployment, codes.regional])

        const error = yield* run.pipe(Effect.provide(gather), Effect.flip)

        expect(error).toEqual(new GatherFailed({ sources: ["Eurostat"], failed: 1 }))
        expect(yield* gatheredOf(codes.unemployment)).toBe("2026-11-06")
        expect(yield* gatheredOf(codes.regional)).toBeNull()

        published.files?.set(fileOf(codes.regional), file(eurostatRecorded.unemployment))
        yield* run.pipe(Effect.provide(gather))

        expect(source.downloads()).toBe(3)
        expect(yield* gatheredOf(codes.regional)).toBe("2026-11-06")
      })
    },
  )

  it.effect("stops gathering after 20 hours and leaves the rest to the next run", () => {
    const { codes, published } = publishingEurostat("LONG")
    const source = serving(published)
    const store = bucket()
    const gather = gatherOver(source.layer, store.bucket)

    // Two datasets of three million values each: one step each.
    const ids = [codes.unemployment, codes.regional]

    // The first Eurostat step ends 21 hours into the run.
    const workflow = steps((name) =>
      name === "gather Eurostat after " ? TestClock.adjust("21 hours") : Effect.void,
    )

    return Effect.gen(function* () {
      published.contents = contents(
        ids.map((id) => ({ id, updated: "06.11.2026", values: 3_000_000 })),
      )
      published.files?.set(fileOf(codes.regional), file(eurostatRecorded.unemployment))

      yield* gatherNow
      yield* catalogueEurostat("LONG", ids)
      yield* Gather.run().pipe(Effect.provide(Layer.merge(workflow.layer, gather)))

      // Datasets go in code order: REG, then UNE.
      expect(source.downloads()).toBe(1)
      expect(yield* gatheredOf(codes.regional)).toBe("2026-11-06")
      expect(yield* gatheredOf(codes.unemployment)).toBeNull()

      yield* run.pipe(Effect.provide(gather))

      expect(source.downloads()).toBe(2)
      expect(yield* gatheredOf(codes.unemployment)).toBe("2026-11-06")
    })
  })

  it.effect("gathers a dataset released today again on the next run", () => {
    const { codes, published } = publishingEurostat("TODAY")
    const source = serving(published)
    const store = bucket()
    const gather = gatherOver(source.layer, store.bucket)

    return Effect.gen(function* () {
      published.contents = contents([{ id: codes.unemployment, updated: "10.11.2026" }])

      yield* gatherNow
      yield* catalogueEurostat("TODAY", [codes.unemployment])
      yield* run.pipe(Effect.provide(gather))

      // Eurostat may publish it again at 23:00 under the same date.
      expect(yield* gatheredOf(codes.unemployment)).toBeNull()

      yield* run.pipe(Effect.provide(gather))

      expect(source.downloads()).toBe(2)
      expect(store.puts("eurostat")).toBe(3)
    })
  })
})
