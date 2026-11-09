import {
  type Country,
  DimensionsMissing,
  IndicatorId,
  IndicatorNotFound,
  SourceUnavailable,
  Year,
} from "@civicdata/domain"
import { describe, expect, it } from "@effect/vitest"
import { DateTime, Effect, Fiber, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"

import { Sdmx } from "../src/Sdmx.ts"
import { http, memory } from "./fakes.ts"
import population from "./fixtures/eurostat/population-flow.json"
import france from "./fixtures/eurostat/population-france.csv?raw"
import uncovered from "./fixtures/eurostat/population-uncovered.xml?raw"
import years from "./fixtures/eurostat/population-years.xml?raw"
import populations from "./fixtures/eurostat/population.csv?raw"
import unemploymentFlow from "./fixtures/eurostat/unemployment-flow.json"
import unemployment from "./fixtures/eurostat/unemployment.csv?raw"
import unknownFlow from "./fixtures/eurostat/unknown-flow.json"
import oecdNoRecords from "./fixtures/oecd/no-records.txt?raw"
import oecdFlow from "./fixtures/oecd/unemployment-flow.json"
import oecdUnemployment from "./fixtures/oecd/unemployment.csv?raw"
import oecdUnknownFlow from "./fixtures/oecd/unknown-flow.txt?raw"

const eurostat = "https://ec.europa.eu/eurostat/api/dissemination"
const oecd = "https://sdmx.oecd.org/public/rest"

const tps00001 = IndicatorId.make("ESTAT,TPS00001,1.0")
const uneRtA = IndicatorId.make("ESTAT,UNE_RT_A,1.0")
const lfs = IndicatorId.make("OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0")

// Eurostat gzips its answer, without saying so in Content-Encoding, unless the
// URL asks `compress=false`.
const eurostatData = (flow: string, geo: string, from: number, to: number) =>
  `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/${flow}/1.0/*?c[geo]=${geo}&c[freq]=A&c[TIME_PERIOD]=ge:${from}+le:${to}&compress=false`

const oecdData = (key: string, from: number, to: number) =>
  `${oecd}/data/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/${key}?startPeriod=${from}&endPeriod=${to}`

// Answers recorded from Eurostat and the OECD on 2026-11-09, served by URL.
const recorded = new Map<string, () => Response>([
  [`${eurostat}/sdmx/2.1/dataflow/ESTAT/TPS00001/1.0?format=JSON`, () => Response.json(population)],
  [
    `${eurostat}/sdmx/2.1/dataflow/ESTAT/NOPE/1.0?format=JSON`,
    () => Response.json(unknownFlow, { status: 404 }),
  ],
  [
    `${eurostat}/sdmx/2.1/dataflow/ESTAT/UNE_RT_A/1.0?format=JSON`,
    () => Response.json(unemploymentFlow),
  ],
  [eurostatData("TPS00001", "FR,EL", 2019, 2021), () => new Response(populations)],
  [eurostatData("TPS00001", "FR,US", 2019, 2021), () => new Response(uncovered, { status: 400 })],
  [eurostatData("TPS00001", "FR", 2019, 2021), () => new Response(france)],
  [eurostatData("TPS00001", "FR", 1960, 1961), () => new Response(years, { status: 400 })],
  [eurostatData("UNE_RT_A", "FR", 2024, 2024), () => new Response(unemployment)],
  [
    `${oecd}/dataflow/OECD.SDD.TPS/DSD_LFS@DF_IALFS_UNE_M/1.0?references=datastructure`,
    () => Response.json(oecdFlow),
  ],
  [
    `${oecd}/dataflow/OECD.SDD.TPS/DSD_NOPE@DF_NOPE/1.0?references=datastructure`,
    () => new Response(oecdUnknownFlow, { status: 404 }),
  ],
  [oecdData("FRA+DEU........A", 2023, 2023), () => new Response(oecdUnemployment)],
  [oecdData("SSD........A", 2023, 2023), () => new Response(oecdNoRecords, { status: 404 })],
])

// The adapter over the recordings, counting the requests that reach a source.
const recording = (cache = memory()) => {
  const asked: Array<string> = []

  const layer = Sdmx.cached.pipe(
    Layer.provide(
      http((url) => {
        asked.push(url)

        return recorded.get(url)?.() ?? new Response("no recording", { status: 500 })
      }),
    ),
    Layer.provide(cache.layer),
  )

  return { layer, asked }
}

interface Query {
  readonly indicator: IndicatorId
  readonly countries: ReadonlyArray<Country>
  readonly from: Year
  readonly to: Year
}

const query = (overrides: Partial<Query> = {}): Query => ({
  indicator: tps00001,
  countries: ["FRA", "GRC"],
  from: Year.make(2019),
  to: Year.make(2021),
  ...overrides,
})

describe("Sdmx with Eurostat", () => {
  it.effect("describes a dataflow by its label and description", () =>
    Effect.gen(function* () {
      const described = yield* (yield* Sdmx).describe(tps00001)

      expect(described.indicator).toEqual({
        id: tps00001,
        name: "Population on 1 January",
        definition: expect.stringMatching(/^The number of persons having their usual residence/),
      })
      expect(described.dataset).toBe("Population on 1 January")
    }).pipe(Effect.provide(recording().layer)),
  )

  it.effect("reads one value per country and year, from Eurostat's own country codes", () =>
    Effect.gen(function* () {
      const series = yield* (yield* Sdmx).observations(query())

      expect(series.observations).toEqual([
        { country: "GRC", year: 2019, value: 10635213 },
        { country: "GRC", year: 2020, value: 10612591 },
        { country: "GRC", year: 2021, value: 10555344 },
        { country: "FRA", year: 2019, value: 67290471 },
        { country: "FRA", year: 2020, value: 67473651 },
        { country: "FRA", year: 2021, value: 67728568 },
      ])
      expect(series.url).toBe(eurostatData("TPS00001", "FR,EL", 2019, 2021))
    }).pipe(Effect.provide(recording().layer)),
  )

  it.effect("asks again without a country the dataflow does not cover", () => {
    const source = recording()

    return Effect.gen(function* () {
      const series = yield* (yield* Sdmx).observations(query({ countries: ["FRA", "USA"] }))

      expect(series.observations.map((observation) => observation.country)).toEqual([
        "FRA",
        "FRA",
        "FRA",
      ])
      expect(series.url).toBe(eurostatData("TPS00001", "FR", 2019, 2021))
      expect(source.asked).toHaveLength(2)
    }).pipe(Effect.provide(source.layer))
  })

  it.effect("finds no values for years the dataflow does not have", () =>
    Effect.gen(function* () {
      const series = yield* (yield* Sdmx).observations(
        query({ countries: ["FRA"], from: Year.make(1960), to: Year.make(1961) }),
      )

      expect(series.observations).toEqual([])
    }).pipe(Effect.provide(recording().layer)),
  )

  it.effect("names the dimensions a dataflow has more than one series for", () =>
    Effect.gen(function* () {
      const error = yield* (yield* Sdmx)
        .observations(
          query({
            indicator: uneRtA,
            countries: ["FRA"],
            from: Year.make(2024),
            to: Year.make(2024),
          }),
        )
        .pipe(Effect.flip)

      expect(error).toEqual(
        new DimensionsMissing({ indicator: uneRtA, dimensions: ["age", "unit", "sex"] }),
      )
    }).pipe(Effect.provide(recording().layer)),
  )

  it.effect("reports an unknown dataflow", () =>
    Effect.gen(function* () {
      const error = yield* (yield* Sdmx)
        .describe(IndicatorId.make("ESTAT,NOPE,1.0"))
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(IndicatorNotFound)
    }).pipe(Effect.provide(recording().layer)),
  )

  it.effect("keeps a series until Eurostat's next update at 11:00 or 23:00 in Luxembourg", () => {
    const source = recording()

    return Effect.gen(function* () {
      const sdmx = yield* Sdmx

      // 10:00 in Luxembourg, which is on CET in November.
      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-09T09:00:00Z")))
      yield* sdmx.observations(query())

      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-09T09:59:00Z")))
      yield* sdmx.observations(query())

      expect(source.asked).toHaveLength(1)

      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-09T10:01:00Z")))
      const after = yield* sdmx.observations(query())

      expect(source.asked).toHaveLength(2)
      expect(DateTime.formatIso(after.retrievedAt)).toBe("2026-11-09T10:01:00.000Z")
    }).pipe(Effect.provide(source.layer))
  })
})

describe("Sdmx with the OECD", () => {
  it.effect("describes a dataflow by its name and plain-text description", () =>
    Effect.gen(function* () {
      const described = yield* (yield* Sdmx).describe(lfs)

      expect(described.indicator.name).toBe("Monthly unemployment rates")
      expect(described.indicator.definition).toMatch(/^The infra-annual dataflow on the monthly/)
      expect(described.indicator.definition).not.toContain("<p>")
    }).pipe(Effect.provide(recording().layer)),
  )

  // The OECD's edge cache ignores `c[...]` filters, so the URL is the contract.
  it.effect("spells out the series key in the data URL, in the dataflow's dimension order", () => {
    const source = recording()

    return Effect.gen(function* () {
      const error = yield* (yield* Sdmx)
        .observations(
          query({
            indicator: lfs,
            countries: ["FRA", "DEU"],
            from: Year.make(2023),
            to: Year.make(2023),
          }),
        )
        .pipe(Effect.flip)

      expect(source.asked).toContain(oecdData("FRA+DEU........A", 2023, 2023))
      expect(error).toEqual(
        new DimensionsMissing({ indicator: lfs, dimensions: ["ADJUSTMENT", "SEX", "AGE"] }),
      )
    }).pipe(Effect.provide(source.layer))
  })

  it.effect("finds no values when the OECD has no records for the countries", () =>
    Effect.gen(function* () {
      const series = yield* (yield* Sdmx).observations(
        query({ indicator: lfs, countries: ["SSD"], from: Year.make(2023), to: Year.make(2023) }),
      )

      expect(series.observations).toEqual([])
    }).pipe(Effect.provide(recording().layer)),
  )

  it.effect("reports an unknown dataflow", () =>
    Effect.gen(function* () {
      const error = yield* (yield* Sdmx)
        .describe(IndicatorId.make("OECD.SDD.TPS,DSD_NOPE@DF_NOPE,1.0"))
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(IndicatorNotFound)
    }).pipe(Effect.provide(recording().layer)),
  )

  it.effect("asks in English", () => {
    const languages: Array<string | undefined> = []

    const layer = Sdmx.layer.pipe(
      Layer.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            languages.push(request.headers["accept-language"])

            return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(oecdFlow)))
          }),
        ),
      ),
    )

    return Effect.gen(function* () {
      yield* (yield* Sdmx).describe(lfs)

      expect(languages).toEqual(["en"])
    }).pipe(Effect.provide(layer))
  })

  it.effect("asks again after server errors", () => {
    let errors = 2

    const flaky = Sdmx.layer.pipe(
      Layer.provide(
        http(() => {
          if (errors === 0) return Response.json(oecdFlow)

          errors -= 1

          return new Response("Internal server error", { status: 500 })
        }),
      ),
    )

    return Effect.gen(function* () {
      const fiber = yield* (yield* Sdmx).describe(lfs).pipe(Effect.forkScoped)

      yield* TestClock.adjust("3 seconds")

      expect((yield* Fiber.join(fiber)).indicator.name).toBe("Monthly unemployment rates")
    }).pipe(Effect.provide(flaky))
  })

  // Retrying a 429 from the Worker's shared IP only extends the block.
  it.effect("reports a refusal over the rate limit once, without retrying", () => {
    const asked: Array<string> = []

    const limited = Sdmx.layer.pipe(
      Layer.provide(
        http((url) => {
          asked.push(url)

          return new Response("You have exceeded the number of requests currently permitted", {
            status: 429,
            headers: { "retry-after": "0" },
          })
        }),
      ),
    )

    return Effect.gen(function* () {
      const error = yield* (yield* Sdmx).describe(lfs).pipe(Effect.flip)

      expect(error).toEqual(new SourceUnavailable({ source: "OECD" }))
      expect(asked).toHaveLength(1)
    }).pipe(Effect.provide(limited))
  })
})
