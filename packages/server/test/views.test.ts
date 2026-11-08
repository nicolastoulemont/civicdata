import {
  Api,
  IndicatorId,
  IndicatorNotFound,
  type ResolvedView,
  Ranking,
  SourceUnavailable,
  TransformNotApplicable,
  Trend,
  Year,
} from "@civicdata/domain"
import { describe, expect, it } from "@effect/vitest"
import { DateTime, Effect, Layer } from "effect"
import { HttpServer } from "effect/http"
import { HttpApiTest } from "effect/http-api"

import { Catalog } from "../src/Catalog.ts"
import { Conversations } from "../src/Conversations.ts"
import { Handlers } from "../src/Handlers.ts"
import { WorldBank } from "../src/WorldBank.ts"

const population = IndicatorId.make("SP.POP.TOTL")
const gdp = IndicatorId.make("NY.GDP.MKTP.CD")
const unemployment = IndicatorId.make("SL.UEM.TOTL.ZS")

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
        { country: "FRA", year: year(2019), value: 67_000_000 },
        { country: "FRA", year: year(2020), value: 68_000_000 },
        { country: "DEU", year: year(2019), value: 83_000_000 },
        { country: "DEU", year: year(2020), value: 84_000_000 },
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
  [unemployment, { name: "Unemployment, total (% of total labor force)", values: [] }],
])

// Answers like the real API: only the requested countries and years, and
// nothing for a country it has no value for.
const worldBank = Layer.succeed(
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
    observations: (query) =>
      Effect.succeed({
        observations: (published.get(query.indicator)?.values ?? []).filter(
          (observation) =>
            query.countries.includes(observation.country) &&
            observation.year >= query.from &&
            observation.year <= query.to,
        ),
        url: `https://api.worldbank.org/v2/indicator/${query.indicator}`,
        retrievedAt,
      }),
    indicators: Effect.succeed([]),
  }),
)

const down = Layer.succeed(
  WorldBank,
  WorldBank.of({
    describe: () => Effect.fail(new SourceUnavailable({ source: "World Bank" })),
    observations: () => Effect.fail(new SourceUnavailable({ source: "World Bank" })),
    indicators: Effect.fail(new SourceUnavailable({ source: "World Bank" })),
  }),
)

// These tests neither search nor ask, so the catalog and the conversations are
// the ones plain `pnpm dev:web` gets.
const serve = (source: Layer.Layer<WorldBank>) =>
  Layer.mergeAll(
    Handlers.pipe(
      Layer.provide(Conversations.unavailable),
      Layer.provide(Catalog.unavailable),
      Layer.provide(source),
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
      expect(resolved.observations).toHaveLength(4)
      expect(resolved.missing).toEqual(["ITA"])
      expect(resolved.sources.map((source) => source.dataset)).toEqual([
        "World Development Indicators",
      ])
      expect(DateTime.formatIso(resolved.sources[0].retrievedAt)).toBe("2026-11-01T09:30:00.000Z")
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
})
