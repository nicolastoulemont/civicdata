import {
  type Country,
  Dimensions,
  DimensionsMissing,
  IndicatorId,
  IndicatorNotFound,
  SourceUnavailable,
  Year,
} from "@civicdata/domain"
import { describe, expect, it } from "@effect/vitest"
import { DateTime, Effect, Fiber, Layer, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"

import { Sdmx } from "../src/Sdmx.ts"
import { http, memory } from "./fakes.ts"
import eurostatFlows from "./fixtures/eurostat/dataflows.json"
import population from "./fixtures/eurostat/population-flow.json"
import franceOptions from "./fixtures/eurostat/population-france-options.csv?raw"
import france from "./fixtures/eurostat/population-france.csv?raw"
import populationOptions from "./fixtures/eurostat/population-options.csv?raw"
import recent from "./fixtures/eurostat/population-recent.csv?raw"
import uncovered from "./fixtures/eurostat/population-uncovered.xml?raw"
import outsideYears from "./fixtures/eurostat/population-years.xml?raw"
import populations from "./fixtures/eurostat/population.csv?raw"
import unemploymentFlow from "./fixtures/eurostat/unemployment-flow.json"
import unemploymentOptions from "./fixtures/eurostat/unemployment-options.csv?raw"
import unemployment from "./fixtures/eurostat/unemployment-total.csv?raw"
import unknownFlow from "./fixtures/eurostat/unknown-flow.json"
import oecdFlows from "./fixtures/oecd/dataflows.json"
import oecdNoRecords from "./fixtures/oecd/no-records.txt?raw"
import oecdFlow from "./fixtures/oecd/unemployment-flow.json"
import oecdOptions from "./fixtures/oecd/unemployment-options.csv?raw"
import oecdUnemployment from "./fixtures/oecd/unemployment-total.csv?raw"
import oecdUnknownFlow from "./fixtures/oecd/unknown-flow.txt?raw"

const eurostat = "https://ec.europa.eu/eurostat/api/dissemination"
const oecd = "https://sdmx.oecd.org/public/rest"

const tps00001 = IndicatorId.make("ESTAT,TPS00001,1.0")
const uneRtA = IndicatorId.make("ESTAT,UNE_RT_A,1.0")
const lfs = IndicatorId.make("OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0")

const picked = Schema.decodeSync(Dimensions)

// The ids of the dimensions a View leaves open, when it fails with them.
const open = (error: IndicatorNotFound | SourceUnavailable | DimensionsMissing) =>
  error instanceof DimensionsMissing ? error.open : []

// Eurostat gzips its answer, without saying so in Content-Encoding, unless the
// URL asks `compress=false`.
const eurostatData = (
  flow: string,
  { geo, years, picks = "" }: { geo: string; years: string; picks?: string },
) =>
  `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/${flow}/1.0/*?c[geo]=${geo}&c[freq]=A${picks}&c[TIME_PERIOD]=${years}&compress=false`

// Each series' latest value, which lists the dataflow's dimensions.
const eurostatOptions = (flow: string, geo: string) =>
  `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/${flow}/1.0/*?c[geo]=${geo}&c[freq]=A&lastNObservations=1&compress=false`

const oecdData = (key: string, from: number, to: number) =>
  `${oecd}/data/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/${key}?startPeriod=${from}&endPeriod=${to}`

const oecdLatest = (key: string) =>
  `${oecd}/data/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/${key}?lastNObservations=1`

// Answers recorded from Eurostat and the OECD on 2026-11-09, served by URL.
const recorded = new Map<string, () => Response>([
  [
    `${eurostat}/sdmx/2.1/dataflow/ESTAT/all/latest?format=JSON&lang=en&detail=allstubs`,
    () => Response.json(eurostatFlows),
  ],
  [`${oecd}/dataflow/all`, () => Response.json(oecdFlows)],
  [`${eurostat}/sdmx/2.1/dataflow/ESTAT/TPS00001/1.0?format=JSON`, () => Response.json(population)],
  [
    `${eurostat}/sdmx/2.1/dataflow/ESTAT/NOPE/1.0?format=JSON`,
    () => Response.json(unknownFlow, { status: 404 }),
  ],
  [
    `${eurostat}/sdmx/2.1/dataflow/ESTAT/UNE_RT_A/1.0?format=JSON`,
    () => Response.json(unemploymentFlow),
  ],
  [eurostatOptions("TPS00001", "FR,EL"), () => new Response(populationOptions)],
  [eurostatOptions("TPS00001", "FR,US"), () => new Response(uncovered, { status: 400 })],
  [eurostatOptions("TPS00001", "FR"), () => new Response(franceOptions)],
  [
    eurostatData("TPS00001", { geo: "FR,EL", years: "ge:2019+le:2021" }),
    () => new Response(populations),
  ],
  [
    eurostatData("TPS00001", { geo: "FR,US", years: "ge:2019+le:2021" }),
    () => new Response(uncovered, { status: 400 }),
  ],
  [eurostatData("TPS00001", { geo: "FR", years: "ge:2019+le:2021" }), () => new Response(france)],
  [
    eurostatData("TPS00001", { geo: "FR,EL", years: "ge:2024+le:2026" }),
    () => new Response(recent),
  ],
  [
    eurostatData("TPS00001", { geo: "FR", years: "ge:1960+le:1961" }),
    () => new Response(outsideYears, { status: 400 }),
  ],
  [eurostatOptions("UNE_RT_A", "FR"), () => new Response(unemploymentOptions)],
  [
    eurostatData("UNE_RT_A", {
      geo: "FR",
      years: "ge:2022+le:2024",
      picks: "&c[age]=Y15-74&c[unit]=PC_ACT&c[sex]=T",
    }),
    () => new Response(unemployment),
  ],
  [
    `${oecd}/dataflow/OECD.SDD.TPS/DSD_LFS@DF_IALFS_UNE_M/1.0?references=datastructure`,
    () => Response.json(oecdFlow),
  ],
  [
    `${oecd}/dataflow/OECD.SDD.TPS/DSD_NOPE@DF_NOPE/1.0?references=datastructure`,
    () => new Response(oecdUnknownFlow, { status: 404 }),
  ],
  [oecdLatest("FRA+DEU........A"), () => new Response(oecdOptions)],
  [oecdData("FRA+DEU....N._T.Y_GE15..A", 2023, 2023), () => new Response(oecdUnemployment)],
  [oecdLatest("SSD........A"), () => new Response(oecdNoRecords, { status: 404 })],
  [oecdData("SSD........A", 2023, 2023), () => new Response(oecdNoRecords, { status: 404 })],
])

// The adapter over the recordings, counting the requests that reach a source.
const recording = (cache = memory()) => {
  const asked: Array<string> = []

  const layer = Sdmx.cached.pipe(
    Layer.provide(
      http((url) => {
        asked.push(url)

        return recorded.get(url)?.() ?? new Response("no recording", { status: 404 })
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
  readonly dimensions: Dimensions
}

const query = (overrides: Partial<Query> = {}): Query => ({
  indicator: tps00001,
  countries: ["FRA", "GRC"],
  from: Year.make(2019),
  to: Year.make(2021),
  dimensions: {},
  ...overrides,
})

const unemploymentIn2022 = query({
  indicator: uneRtA,
  countries: ["FRA"],
  from: Year.make(2022),
  to: Year.make(2024),
})

describe("Sdmx with Eurostat", () => {
  it.effect("lists Eurostat's datasets, without the saved views of them", () =>
    Effect.gen(function* () {
      const listed = yield* (yield* Sdmx).indicators("Eurostat")

      expect(listed).toEqual([
        {
          indicator: "ESTAT,LFSQ_EGAN21,1.0",
          name: "Employed persons by economic activity (NACE Rev. 2.1) - quarterly data",
          definition: "",
        },
        { indicator: "ESTAT,TPS00001,1.0", name: "Population on 1 January", definition: "" },
        {
          indicator: "ESTAT,UNE_RT_A,1.0",
          name: "Unemployment by sex and age - annual data",
          definition: "",
        },
      ])
    }).pipe(Effect.provide(recording().layer)),
  )

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
      expect(series.url).toBe(eurostatData("TPS00001", { geo: "FR,EL", years: "ge:2019+le:2021" }))
      expect(series.dimensions).toEqual([])
    }).pipe(Effect.provide(recording().layer)),
  )

  it.effect("keeps Eurostat's flags on each value", () =>
    Effect.gen(function* () {
      const series = yield* (yield* Sdmx).observations(
        query({ from: Year.make(2024), to: Year.make(2026) }),
      )

      expect(series.observations.filter((observation) => observation.year === 2026)).toEqual([
        { country: "GRC", year: 2026, value: 10366586, flags: ["Estimated", "Provisional"] },
        { country: "FRA", year: 2026, value: 69112309, flags: ["Provisional"] },
      ])
      expect(series.observations.find((observation) => observation.year === 2025)).toEqual({
        country: "GRC",
        year: 2025,
        value: 10372335,
      })
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
      expect(series.url).toBe(eurostatData("TPS00001", { geo: "FR", years: "ge:2019+le:2021" }))
      // Its options and its data, each asked again without the USA.
      expect(source.asked).toHaveLength(4)
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

  it.effect(
    "names the dimensions a View leaves open, with their values, before asking for data",
    () => {
      const source = recording()

      return Effect.gen(function* () {
        const error = yield* (yield* Sdmx).observations(unemploymentIn2022).pipe(Effect.flip)

        expect(error).toBeInstanceOf(DimensionsMissing)
        expect(open(error)).toEqual(["age", "unit", "sex"])
        expect(
          error instanceof DimensionsMissing
            ? error.dimensions.find(({ id }) => id === "sex")
            : undefined,
        ).toEqual({
          id: "sex",
          label: "Sex",
          options: [
            { code: "F", label: "Females" },
            { code: "M", label: "Males" },
            { code: "T", label: "Total" },
          ],
        })
        expect(source.asked).not.toContain(expect.stringContaining("TIME_PERIOD"))
      }).pipe(Effect.provide(source.layer))
    },
  )

  it.effect("reads the series a View picks and lists the values it could pick instead", () =>
    Effect.gen(function* () {
      const series = yield* (yield* Sdmx).observations({
        ...unemploymentIn2022,
        dimensions: picked({ age: "Y15-74", unit: "PC_ACT", sex: "T" }),
      })

      expect(series.observations).toEqual([
        { country: "FRA", year: 2022, value: 7.3 },
        { country: "FRA", year: 2023, value: 7.4 },
        { country: "FRA", year: 2024, value: 7.4 },
      ])
      expect(series.dimensions.map(({ id, options }) => [id, options.length])).toEqual([
        ["age", 7],
        ["unit", 3],
        ["sex", 3],
      ])
    }).pipe(Effect.provide(recording().layer)),
  )

  it.effect("treats a value a dimension does not take as left open", () =>
    Effect.gen(function* () {
      const error = yield* (yield* Sdmx)
        .observations({
          ...unemploymentIn2022,
          dimensions: picked({ age: "Y15-74", unit: "PC_ACT", sex: "X" }),
        })
        .pipe(Effect.flip)

      expect(open(error)).toEqual(["sex"])
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

      // Its options and its data.
      expect(source.asked).toHaveLength(2)

      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-09T10:01:00Z")))
      const after = yield* sdmx.observations(query())

      expect(source.asked).toHaveLength(4)
      expect(DateTime.formatIso(after.retrievedAt)).toBe("2026-11-09T10:01:00.000Z")
    }).pipe(Effect.provide(source.layer))
  })
})

describe("Sdmx with the OECD", () => {
  it.effect("lists the OECD's own dataflows, with plain-text descriptions", () =>
    Effect.gen(function* () {
      const listed = yield* (yield* Sdmx).indicators("OECD")

      // ESTAT and IAEG-SDGs dataflows that the OECD also lists are dropped.
      expect(listed.map((entry) => entry.indicator)).toEqual([
        "OECD.SDD.NAD,DSD_NAMAIN10@DF_TABLE1_EXPENDITURE_HCPC,2.0",
        "OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0",
      ])
      expect(listed[1]?.name).toBe("Monthly unemployment rates")
      expect(listed[1]?.definition).toMatch(/^The infra-annual dataflow on the monthly/)
      expect(listed[1]?.definition).not.toContain("<p>")
    }).pipe(Effect.provide(recording().layer)),
  )

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
      const sdmx = yield* Sdmx

      const asked = query({
        indicator: lfs,
        countries: ["FRA", "DEU"],
        from: Year.make(2023),
        to: Year.make(2023),
      })

      const error = yield* sdmx.observations(asked).pipe(Effect.flip)

      expect(open(error)).toEqual(["ADJUSTMENT", "SEX", "AGE"])

      const series = yield* sdmx.observations({
        ...asked,
        dimensions: picked({ ADJUSTMENT: "N", SEX: "_T", AGE: "Y_GE15" }),
      })

      expect(series.url).toBe(oecdData("FRA+DEU....N._T.Y_GE15..A", 2023, 2023))
      expect(series.observations).toEqual([
        { country: "FRA", year: 2023, value: 7.391667 },
        { country: "DEU", year: 2023, value: 3.083333 },
      ])
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

  it.effect("fails a listing the OECD refuses", () => {
    const limited = Sdmx.layer.pipe(
      Layer.provide(http(() => new Response("Too many requests", { status: 429 }))),
    )

    return Effect.gen(function* () {
      const error = yield* (yield* Sdmx).indicators("OECD").pipe(Effect.flip)

      expect(error).toEqual(new SourceUnavailable({ source: "OECD" }))
    }).pipe(Effect.provide(limited))
  })
})
