import {
  Api,
  Change,
  Dimensions,
  DimensionsMissing,
  IndicatorId,
  IndicatorNotes,
  IndicatorNotFound,
  type ResolvedView,
  Ranking,
  Ratio,
  Relation,
  SourceUnavailable,
  TransformNotApplicable,
  Trend,
  Year,
} from "@civicdata/domain"
import { describe, expect, it } from "@effect/vitest"
import { reset } from "cloudflare:test"
import { DateTime, Effect, Layer, Schema } from "effect"
import { HttpServer } from "effect/http"
import { HttpApiTest } from "effect/http-api"

import { Policy } from "../src/Adapter.ts"
import { Agent } from "../src/Agent.ts"
import { AskLimit } from "../src/AskLimit.ts"
import { Catalog } from "../src/Catalog.ts"
import { Conversations } from "../src/Conversations.ts"
import { Directions } from "../src/Directions.ts"
import { Handlers } from "../src/Handlers.ts"
import { Insee } from "../src/Insee.ts"
import { Notes } from "../src/Notes.ts"
import { Politics } from "../src/Politics.ts"
import { Sdmx } from "../src/Sdmx.ts"
import { Sources } from "../src/Sources.ts"
import { titles } from "../src/titles.gen.ts"
import { WorldBank } from "../src/WorldBank.ts"
import { build, catalogOver, entry, listings, stored } from "./catalog.ts"
import { chose, decisions } from "./decisions.ts"
import { http, memory, offline } from "./fakes.ts"
import populationFlow from "./fixtures/eurostat/population-flow.json"
import populationOptions from "./fixtures/eurostat/population-options.csv?raw"
import uncovered from "./fixtures/eurostat/population-uncovered.xml?raw"
import populations from "./fixtures/eurostat/population.csv?raw"
import unemploymentFlow from "./fixtures/eurostat/unemployment-flow.json"
import unemploymentOptions from "./fixtures/eurostat/unemployment-options.csv?raw"
import unemploymentRates from "./fixtures/eurostat/unemployment-total.csv?raw"
import unemploymentNotes from "./fixtures/oecd/unemployment-notes.csv?raw"

const population = IndicatorId.make("SP.POP.TOTL")
const gdp = IndicatorId.make("NY.GDP.MKTP.CD")
const unemployment = IndicatorId.make("SL.UEM.TOTL.ZS")

// Published after the titles were generated, so it has no plain title.
const untitled = IndicatorId.make("XX.NEW.INDICATOR")

// When the fake World Bank was asked; provenance must carry it through.
const retrievedAt = DateTime.makeUnsafe("2026-11-01T09:30:00Z")

const year = (value: number) => Year.make(value)

// What the fake World Bank publishes: a name and values per indicator.
const published = new Map<IndicatorId, { name: string; values: ResolvedView["observations"] }>([
  [
    population,
    {
      name: "Population, total",
      values: [
        { country: "FRA", year: year(2018), value: 66_000_000 },
        { country: "FRA", year: year(2019), value: 67_000_000 },
        { country: "FRA", year: year(2020), value: 68_000_000 },
        { country: "DEU", year: year(2019), value: 83_000_000 },
        { country: "DEU", year: year(2020), value: 84_000_000 },
        { country: "ESP", year: year(2020), value: 47_000_000 },
      ],
    },
  ],
  [
    gdp,
    {
      name: "GDP (current US$)",
      values: [
        { country: "FRA", year: year(2020), value: 2_720_000_000_000 },
        { country: "DEU", year: year(2020), value: 3_940_000_000_000 },
      ],
    },
  ],
  [
    unemployment,
    {
      name: "Unemployment, total (% of total labor force)",
      values: [
        { country: "FRA", year: year(2022), value: 7.9 },
        { country: "FRA", year: year(2023), value: 7.9 },
        { country: "FRA", year: year(2024), value: 7.4 },
      ],
    },
  ],
  [untitled, { name: "New indicator (% of total)", values: [] }],
])

// Answers like the real API: only the requested countries and years, and
// nothing for a country it has no value for. Notes each request for values
// in `asked`.
const worldBankNoting = (asked: Array<string> = []) =>
  Layer.succeed(
    WorldBank,
    WorldBank.of({
      describe: (indicator) => {
        const known = published.get(indicator)

        return known === undefined
          ? Effect.fail(new IndicatorNotFound({ indicator }))
          : Effect.succeed({
              indicator: { id: indicator, name: known.name, definition: "" },
              dataset: "World Development Indicators",
              retrievedAt,
            })
      },
      fetch: (query) =>
        Effect.sync(() => {
          asked.push(`${query.indicator} ${query.from}-${query.to}`)
        }).pipe(
          Effect.as({
            observations: (published.get(query.indicator)?.values ?? []).filter(
              (observation) =>
                query.countries.includes(observation.country) &&
                observation.year >= query.from &&
                observation.year <= query.to,
            ),
            url: `https://api.worldbank.org/v2/indicator/${query.indicator}`,
            retrievedAt,
            dimensions: [],
          }),
        ),
      policy: Policy.Api(),
      list: Effect.succeed([]),
    }),
  )

const worldBank = worldBankNoting()

const down = Layer.succeed(
  WorldBank,
  WorldBank.of({
    describe: () => Effect.fail(new SourceUnavailable({ source: "World Bank" })),
    fetch: () => Effect.fail(new SourceUnavailable({ source: "World Bank" })),
    policy: Policy.Api(),
    list: Effect.fail(new SourceUnavailable({ source: "World Bank" })),
  }),
)

const eurostat = "https://ec.europa.eu/eurostat/api/dissemination"

// Unemployment as a share of the labour force, for everyone aged 15 to 74.
const totalAged15To74 = Schema.decodeSync(Dimensions)({
  age: "Y15-74",
  unit: "PC_ACT",
  sex: "T",
})

// Eurostat as recorded on 2026-11-09: population on 1 January for France and
// Greece, refused with the United States, which it does not cover; and
// unemployment rates for France, which come in several series, and the total
// for 15 to 74 year-olds.
const eurostatRecording = (url: string) =>
  new Map([
    [`${eurostat}/sdmx/2.1/dataflow/ESTAT/TPS00001/1.0?format=JSON`, Response.json(populationFlow)],
    [
      `${eurostat}/sdmx/2.1/dataflow/ESTAT/UNE_RT_A/1.0?format=JSON`,
      Response.json(unemploymentFlow),
    ],
    [
      `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/TPS00001/1.0/*?c[geo]=FR,EL,US&c[freq]=A&c[TIME_PERIOD]=ge:2019+le:2021&compress=false`,
      new Response(uncovered, { status: 400 }),
    ],
    [
      `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/TPS00001/1.0/*?c[geo]=FR,EL&c[freq]=A&c[TIME_PERIOD]=ge:2019+le:2021&compress=false`,
      new Response(populations),
    ],
    [
      `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/TPS00001/1.0/*?c[geo]=FR,EL,US&c[freq]=A&lastNObservations=1&compress=false`,
      new Response(uncovered, { status: 400 }),
    ],
    [
      `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/TPS00001/1.0/*?c[geo]=FR,EL&c[freq]=A&lastNObservations=1&compress=false`,
      new Response(populationOptions),
    ],
    [
      `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/UNE_RT_A/1.0/*?c[geo]=FR&c[freq]=A&lastNObservations=1&compress=false`,
      new Response(unemploymentOptions),
    ],
    [
      `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/UNE_RT_A/1.0/*?c[geo]=FR&c[freq]=A&c[age]=Y15-74&c[unit]=PC_ACT&c[sex]=T&c[TIME_PERIOD]=ge:2022+le:2024&compress=false`,
      new Response(unemploymentRates),
    ],
  ]).get(url) ?? new Response("no recording", { status: 404 })

// Recorded Eurostat, noting each URL asked for in `asked`. A request for
// values names its years (TIME_PERIOD); one for a dataflow's series asks
// for the latest value only.
const recordedEurostat = (asked: Array<string> = []) =>
  Sdmx.layer.pipe(
    Layer.provide(
      http((url) => {
        asked.push(url)

        return eurostatRecording(url)
      }),
    ),
  )

// Most tests read no indicator notes.
const noNotes = Layer.succeed(Notes, Notes.of({ get: () => Effect.die("no notes in these tests") }))

// These tests neither search nor ask, so the catalog, the conversations and
// the agent are the ones plain `pnpm dev:web` gets.
const serve = (
  source: Layer.Layer<WorldBank>,
  {
    sdmx = Sdmx.layer.pipe(Layer.provide(offline)),
    notes = noNotes,
    directions = Directions.listed,
  }: {
    sdmx?: Layer.Layer<Sdmx>
    notes?: Layer.Layer<Notes>
    directions?: Layer.Layer<Directions>
  } = {},
) =>
  Layer.mergeAll(
    Handlers.pipe(
      Layer.provide(notes),
      Layer.provide(Conversations.unavailable),
      Layer.provide(Agent.unavailable),
      Layer.provide(AskLimit.none),
      Layer.provide(Catalog.unavailable),
      Layer.provide(Politics.unavailable),
      Layer.provide(Sources.layer),
      Layer.provide(Insee.layer.pipe(Layer.provide(offline))),
      Layer.provide(source),
      Layer.provide(sdmx),
      Layer.provide(directions),
    ),
    HttpServer.layerServices,
  )

const trend = (overrides: Partial<Trend> = {}) =>
  Trend.make({
    indicator: population,
    countries: ["FRA", "DEU"],
    from: Year.make(2019),
    to: Year.make(2020),
    ...overrides,
  })

describe("POST /api/views/resolve", () => {
  it.effect("resolves a trend, listing the countries with no data", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])

      const resolved = yield* client.views.resolve({
        payload: trend({ countries: ["FRA", "DEU", "ITA"] }),
      })

      expect(resolved.indicator.name).toBe("Population, total")
      expect(resolved.title).toBe(titles.get(population))
      expect(resolved.observations).toHaveLength(4)
      expect(resolved.missing).toEqual(["ITA"])
      expect(resolved.sources.map((source) => source.dataset)).toEqual([
        "World Development Indicators",
      ])
      expect(DateTime.formatIso(resolved.sources[0].retrievedAt)).toBe("2026-11-01T09:30:00.000Z")
    }).pipe(Effect.provide(serve(worldBank))),
  )

  it.effect("titles an indicator without a plain title by its official name", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])

      const resolved = yield* client.views.resolve({ payload: trend({ indicator: untitled }) })

      expect(resolved.title).toBe("New indicator (% of total)")
    }).pipe(Effect.provide(serve(worldBank))),
  )

  it.effect("resolves a ranking for its single year", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])

      const resolved = yield* client.views.resolve({
        payload: Ranking.make({
          indicator: population,
          countries: ["FRA", "DEU"],
          year: Year.make(2020),
        }),
      })

      expect(resolved.observations.map((observation) => observation.year)).toEqual([2020, 2020])
    }).pipe(Effect.provide(serve(worldBank))),
  )

  it.effect("resolves a ranking over time for every year of its span, in one request", () => {
    const asked: Array<string> = []

    return Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])

      const resolved = yield* client.views.resolve({
        payload: Ranking.make({
          indicator: IndicatorId.make("ESTAT,TPS00001,1.0"),
          countries: ["FRA", "GRC"],
          year: year(2020),
          span: { from: year(2019), to: year(2021) },
        }),
      })

      expect(resolved.observations.map((each) => `${each.country} ${each.year}`)).toEqual([
        "GRC 2019",
        "GRC 2020",
        "GRC 2021",
        "FRA 2019",
        "FRA 2020",
        "FRA 2021",
      ])
      expect(asked.filter((url) => url.includes("TIME_PERIOD"))).toEqual([
        `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/TPS00001/1.0/*?c[geo]=FR,EL&c[freq]=A&c[TIME_PERIOD]=ge:2019+le:2021&compress=false`,
      ])
    }).pipe(Effect.provide(serve(worldBank, { sdmx: recordedEurostat(asked) })))
  })

  it.effect("resolves a change to its two years, missing a country without both", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])

      const resolved = yield* client.views.resolve({
        payload: Change.make({
          indicator: population,
          countries: ["FRA", "ESP"],
          from: year(2018),
          to: year(2020),
        }),
      })

      expect(resolved.observations).toEqual([
        { country: "FRA", year: 2018, value: 66_000_000 },
        { country: "FRA", year: 2020, value: 68_000_000 },
        { country: "ESP", year: 2020, value: 47_000_000 },
      ])
      expect(resolved.missing).toEqual(["ESP"])
    }).pipe(Effect.provide(serve(worldBank))),
  )

  it.effect("says a hand-checked indicator's chart is better lower", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])

      const resolved = yield* client.views.resolve({
        payload: Change.make({
          indicator: unemployment,
          countries: ["FRA"],
          from: year(2022),
          to: year(2024),
        }),
      })

      expect(resolved.direction).toBe("Lower")
    }).pipe(Effect.provide(serve(worldBank))),
  )

  it.effect("leaves an indicator nobody checked neutral", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])

      const resolved = yield* client.views.resolve({ payload: trend() })

      expect(resolved.direction).toBe("Neutral")
    }).pipe(Effect.provide(serve(worldBank))),
  )

  it.effect(
    "gives a chart the direction the catalog build classified, off the hand-checked list",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(reset)

        // The Decisions answer for GDP, which the list does not hold.
        const model = decisions({ answers: { [gdp]: chose(gdp, "Higher", 0.93) } })

        yield* build(1).pipe(
          Effect.provide(
            catalogOver(listings({ "World Bank": [entry(gdp, "GDP (current US$)")] }), {
              classifier: model.classifier,
            }),
          ),
        )

        const client = yield* HttpApiTest.groups(Api, ["views"])

        const resolved = yield* client.views.resolve({
          payload: Ranking.make({ indicator: gdp, countries: ["FRA", "DEU"], year: year(2020) }),
        })

        expect(resolved.direction).toBe("Higher")
      }).pipe(Effect.provide(serve(worldBank, { directions: stored }))),
  )

  it.effect("plots one indicator against another, citing both", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])

      const resolved = yield* client.views.resolve({
        payload: Relation.make({
          indicator: gdp,
          against: population,
          countries: ["FRA", "ESP"],
          year: year(2020),
        }),
      })

      expect(resolved).toMatchObject({
        indicator: { name: "GDP (current US$)" },
        observations: [{ country: "FRA", year: 2020, value: 2_720_000_000_000 }],
        against: {
          indicator: { name: "Population, total" },
          observations: [
            { country: "FRA", year: 2020, value: 68_000_000 },
            { country: "ESP", year: 2020, value: 47_000_000 },
          ],
        },
        missing: ["ESP"],
      })
      expect(resolved.sources.map((source) => source.indicator)).toEqual([gdp, population])
    }).pipe(Effect.provide(serve(worldBank))),
  )

  it.effect(
    "resolves a relation over time for both indicators over its span, one request each",
    () => {
      const asked: Array<string> = []

      return Effect.gen(function* () {
        const client = yield* HttpApiTest.groups(Api, ["views"])

        const resolved = yield* client.views.resolve({
          payload: Relation.make({
            indicator: gdp,
            against: population,
            countries: ["FRA", "DEU"],
            year: year(2020),
            span: { from: year(2018), to: year(2020) },
          }),
        })

        expect(asked).toEqual([`${gdp} 2018-2020`, `${population} 2018-2020`])
        expect("against" in resolved && resolved.against.observations).toHaveLength(5)
        expect(resolved.missing).toEqual([])
      }).pipe(Effect.provide(serve(worldBankNoting(asked))))
    },
  )

  it.effect("fails with IndicatorNotFound for an unknown indicator", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])

      const error = yield* client.views
        .resolve({ payload: trend({ indicator: IndicatorId.make("NOT.A.REAL") }) })
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(IndicatorNotFound)
    }).pipe(Effect.provide(serve(worldBank))),
  )

  it.effect("fails with SourceUnavailable when the World Bank is down", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])
      const error = yield* client.views.resolve({ payload: trend() }).pipe(Effect.flip)

      expect(error).toBeInstanceOf(SourceUnavailable)
    }).pipe(Effect.provide(serve(down))),
  )

  it.effect("divides a total by population, citing both series", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])

      const resolved = yield* client.views.resolve({
        payload: Ranking.make({
          indicator: gdp,
          countries: ["FRA", "DEU"],
          year: year(2020),
          transform: "PerPerson",
        }),
      })

      expect(resolved.observations).toEqual([
        { country: "FRA", year: 2020, value: 40_000 },
        { country: "DEU", year: 2020, value: 3_940_000_000_000 / 84_000_000 },
      ])
      expect(resolved.sources.map((source) => source.indicator)).toEqual([gdp, population])
    }).pipe(Effect.provide(serve(worldBank))),
  )

  it.effect("divides one indicator by another, citing both by name", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])

      const resolved = yield* client.views.resolve({
        payload: Trend.make({
          indicator: population,
          countries: ["FRA", "DEU"],
          from: year(2020),
          to: year(2020),
          transform: Ratio.make({ per: gdp }),
        }),
      })

      expect(resolved.observations).toEqual([
        { country: "FRA", year: 2020, value: 68_000_000 / 2_720_000_000_000 },
        { country: "DEU", year: 2020, value: 84_000_000 / 3_940_000_000_000 },
      ])
      expect(resolved.sources.map(({ indicator, name }) => [indicator, name])).toEqual([
        [population, "Population, total"],
        [gdp, "GDP (current US$)"],
      ])
    }).pipe(Effect.provide(serve(worldBank))),
  )

  it.effect("fails with IndicatorNotFound for a ratio to an unknown indicator", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])

      const error = yield* client.views
        .resolve({
          payload: trend({ transform: Ratio.make({ per: IndicatorId.make("NOT.A.REAL") }) }),
        })
        .pipe(Effect.flip)

      expect(error).toEqual(new IndicatorNotFound({ indicator: IndicatorId.make("NOT.A.REAL") }))
    }).pipe(Effect.provide(serve(worldBank))),
  )

  it.effect("fails with TransformNotApplicable for a percentage per person", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])

      const error = yield* client.views
        .resolve({
          payload: Ranking.make({
            indicator: unemployment,
            countries: ["FRA"],
            year: year(2020),
            transform: "PerPerson",
          }),
        })
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(TransformNotApplicable)
    }).pipe(Effect.provide(serve(worldBank))),
  )

  it.effect("resolves a Eurostat dataflow and credits Eurostat", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])

      const resolved = yield* client.views.resolve({
        payload: trend({
          indicator: IndicatorId.make("ESTAT,TPS00001,1.0"),
          countries: ["FRA", "GRC", "USA"],
          from: year(2019),
          to: year(2021),
        }),
      })

      expect(resolved.indicator.name).toBe("Population on 1 January")
      expect(resolved.observations).toHaveLength(6)
      expect(resolved.missing).toEqual(["USA"])
      expect(resolved.sources).toEqual([
        {
          indicator: "ESTAT,TPS00001,1.0",
          name: "Population on 1 January",
          source: "Eurostat",
          dataset: "Population on 1 January",
          url: `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/TPS00001/1.0/*?c[geo]=FR,EL&c[freq]=A&c[TIME_PERIOD]=ge:2019+le:2021&compress=false`,
          retrievedAt: expect.anything(),
        },
      ])
    }).pipe(Effect.provide(serve(worldBank, { sdmx: recordedEurostat() }))),
  )

  it.effect("fails with DimensionsMissing for a dataflow with several series", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])

      const error = yield* client.views
        .resolve({
          payload: Ranking.make({
            indicator: IndicatorId.make("ESTAT,UNE_RT_A,1.0"),
            countries: ["FRA"],
            year: year(2024),
          }),
        })
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(DimensionsMissing)
    }).pipe(Effect.provide(serve(worldBank, { sdmx: recordedEurostat() }))),
  )

  it.effect("resolves the series a View picks, listing what else it can pick", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])

      const resolved = yield* client.views.resolve({
        payload: trend({
          indicator: IndicatorId.make("ESTAT,UNE_RT_A,1.0"),
          countries: ["FRA"],
          from: year(2022),
          to: year(2024),
          dimensions: totalAged15To74,
        }),
      })

      expect(resolved.observations.map(({ value }) => value)).toEqual([7.3, 7.4, 7.4])
      expect(resolved.dimensions.map(({ id }) => id)).toEqual(["age", "unit", "sex"])
    }).pipe(Effect.provide(serve(worldBank, { sdmx: recordedEurostat() }))),
  )

  it.effect("notes where another source's values for the same figure differ", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["views"])

      const resolved = yield* client.views.resolve({
        payload: trend({
          indicator: unemployment,
          countries: ["FRA"],
          from: year(2022),
          to: year(2024),
        }),
      })

      // Eurostat agrees in 2024; the OECD has no recording, so it is left out.
      expect(resolved.disagreements).toEqual([
        {
          source: {
            indicator: "ESTAT,UNE_RT_A,1.0",
            name: "Unemployment by sex and age - annual data",
            source: "Eurostat",
            dataset: "Unemployment by sex and age - annual data",
            url: `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/UNE_RT_A/1.0/*?c[geo]=FR&c[freq]=A&c[age]=Y15-74&c[unit]=PC_ACT&c[sex]=T&c[TIME_PERIOD]=ge:2022+le:2024&compress=false`,
            retrievedAt: expect.anything(),
          },
          observations: [
            { country: "FRA", year: 2022, value: 7.3 },
            { country: "FRA", year: 2023, value: 7.4 },
          ],
        },
      ])
    }).pipe(Effect.provide(serve(worldBank, { sdmx: recordedEurostat() }))),
  )
})

describe("GET /api/indicators/:indicator/notes", () => {
  // The OECD's notes on monthly unemployment, as recorded on 2026-11-10.
  const recordedOecd = Notes.layer.pipe(
    Layer.provide(
      http((url) =>
        url ===
        "https://sdmx.oecd.org/public/rest/v2/data/dataflow/OECD.SDD.TPS/DSD_LFS@DF_IALFS_UNE_M/1.0/*?attributes=msd&measures=none"
          ? new Response(unemploymentNotes)
          : new Response("no recording", { status: 404 }),
      ),
    ),
    Layer.provide(memory().layer),
  )

  it.effect("reads the OECD's notes on the chart's countries and series", () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ["indicators"])

      const notes = yield* client.indicators.notes({
        params: { indicator: IndicatorId.make("OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0") },
        query: {
          countries: ["IRL", "FRA"],
          dimensions: yield* Schema.decodeEffect(Dimensions)({ MEASURE: "UNE_LF_M", SEX: "_T" }),
        },
      })

      expect(
        IndicatorNotes.guards.OECD(notes) && notes.notes.map(({ country }) => country),
      ).toEqual(["FRA", null, "IRL"])
    }).pipe(Effect.provide(serve(worldBank, { notes: recordedOecd }))),
  )
})
