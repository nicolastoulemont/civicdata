import {
  Api,
  IndicatorId,
  IndicatorNotFound,
  type ResolvedView,
  Ranking,
  SourceUnavailable,
  Trend,
  Year,
} from "@civicdata/domain"
import { describe, expect, it } from "@effect/vitest"
import { DateTime, Effect, Layer } from "effect"
import { HttpServer } from "effect/http"
import { HttpApiTest } from "effect/http-api"

import { Catalog } from "../src/Catalog.ts"
import { Handlers } from "../src/Handlers.ts"
import { WorldBank } from "../src/WorldBank.ts"

const population = IndicatorId.make("SP.POP.TOTL")

// When the fake World Bank was asked; provenance must carry it through.
const retrievedAt = DateTime.makeUnsafe("2026-11-01T09:30:00Z")

const reported: ResolvedView["observations"] = [
  { country: "FRA", year: Year.make(2019), value: 67_388_001 },
  { country: "FRA", year: Year.make(2020), value: 67_571_107 },
  { country: "DEU", year: Year.make(2019), value: 83_092_962 },
  { country: "DEU", year: Year.make(2020), value: 83_160_871 },
]

// A World Bank that knows one indicator and answers like the real API: only
// the requested countries and years, and nothing for a country it has no
// value for.
const worldBank = Layer.succeed(
  WorldBank,
  WorldBank.of({
    describe: (indicator) =>
      indicator === population
        ? Effect.succeed({
            indicator: {
              id: population,
              name: "Population, total",
              definition: "Midyear estimates.",
            },
            dataset: "World Development Indicators",
            retrievedAt,
          })
        : Effect.fail(new IndicatorNotFound({ indicator })),
    observations: (query) =>
      Effect.succeed({
        observations: reported.filter(
          (observation) =>
            query.countries.includes(observation.country) &&
            observation.year >= query.from &&
            observation.year <= query.to,
        ),
        url: "https://api.worldbank.org/v2/country/FRA;DEU/indicator/SP.POP.TOTL",
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

// These tests do not search, so the catalog is the one plain `pnpm dev` gets.
const serve = (source: Layer.Layer<WorldBank>) =>
  Layer.mergeAll(
    Handlers.pipe(Layer.provide(Catalog.unavailable), Layer.provide(source)),
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
      expect(resolved.provenance.dataset).toBe("World Development Indicators")
      expect(DateTime.formatIso(resolved.provenance.retrievedAt)).toBe("2026-11-01T09:30:00.000Z")
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
})
