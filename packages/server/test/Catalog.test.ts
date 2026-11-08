import { type CatalogEntry, IndicatorId, SourceUnavailable } from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
import { beforeEach, describe, expect, it } from "@effect/vitest"
import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"

import { Catalog } from "../src/Catalog.ts"
import { WorldBank } from "../src/WorldBank.ts"

const entry = (indicator: string, name: string, definition = ""): CatalogEntry => ({
  indicator: IndicatorId.make(indicator),
  name,
  definition,
})

const published = [
  entry(
    "SP.POP.TOTL",
    "Population, total",
    "Total population is based on the de facto definition.",
  ),
  entry("SP.POP.GROW", "Population growth (annual %)", "Annual population growth rate."),
  entry("SL.UEM.1524.ZS", "Unemployment, youth total (% of total labor force ages 15-24)"),
  // Matches "SP.POP" by word prefixes ("sp", "pop"), with no code match.
  entry("SH.MED.SAOP.P5", "Specialist surgical workforce (per 100,000 population)"),
  entry(
    "SL.UEM.TOTL.ZS",
    "Unemployment, total (% of total labor force)",
    "Share of the labor force without work.",
  ),
  entry(
    "SP.DYN.LE00.IN",
    "Life expectancy at birth, total (years)",
    "Years a newborn would live if the population's mortality stayed the same.",
  ),
]

// A World Bank whose indicator list the test controls, counting the times it
// was asked.
const worldBank = (
  answers: { up: boolean },
  indicators: ReadonlyArray<CatalogEntry> = published,
) => {
  let requests = 0

  const layer = Layer.succeed(
    WorldBank,
    WorldBank.of({
      describe: () => Effect.die("not used by the catalog"),
      observations: () => Effect.die("not used by the catalog"),
      indicators: Effect.suspend(() => {
        requests += 1

        return answers.up
          ? Effect.succeed(indicators)
          : Effect.fail(new SourceUnavailable({ source: "World Bank" }))
      }),
    }),
  )

  return { layer, requests: () => requests }
}

const db = env.DB

if (db === undefined) throw new Error("vitest.config.ts must bind a D1 database as DB")

// The real catalog over the test Worker's local D1 database.
const catalogOver = (source: Layer.Layer<WorldBank>) =>
  Catalog.layer.pipe(Layer.provide(source), Layer.provide(D1Client.layer({ db }).pipe(Layer.orDie)))

// The test Worker's D1 database is shared by the tests in this file.
beforeEach(async () => {
  await db.exec("DROP TABLE IF EXISTS catalog; DROP TABLE IF EXISTS catalog_refresh;")
})

const names = (entries: ReadonlyArray<CatalogEntry>) => entries.map((found) => found.name)

describe("Catalog", () => {
  it.effect("loads an empty catalog on the first search, ranking name matches first", () => {
    const source = worldBank({ up: true })

    return Effect.gen(function* () {
      const catalog = yield* Catalog

      expect(names(yield* catalog.search("youth unemploy"))).toEqual([
        "Unemployment, youth total (% of total labor force ages 15-24)",
      ])
      // A match in the name outranks one only in the definition.
      const population = names(yield* catalog.search("Population"))

      expect(population.slice(0, 3).toSorted()).toEqual([
        "Population growth (annual %)",
        "Population, total",
        "Specialist surgical workforce (per 100,000 population)",
      ])
      expect(population[3]).toBe("Life expectancy at birth, total (years)")
      expect(source.requests()).toBe(1)
    }).pipe(Effect.provide(catalogOver(source.layer)))
  })

  it.effect("ranks indicators whose code starts with the search first", () =>
    Effect.gen(function* () {
      const found = yield* (yield* Catalog).search("SP.POP")

      expect(
        found
          .slice(0, 2)
          .map((match) => match.indicator)
          .toSorted(),
      ).toEqual(["SP.POP.GROW", "SP.POP.TOTL"])
      expect(found.map((match) => match.indicator)).toContain("SH.MED.SAOP.P5")
    }).pipe(Effect.provide(catalogOver(worldBank({ up: true }).layer))),
  )

  it.effect("loads a catalog larger than one insert", () => {
    const many = Array.from({ length: 600 }, (_, index) =>
      entry(`TEST.${index}`, index === 599 ? "Last indicator loaded" : `Indicator ${index}`),
    )

    return Effect.gen(function* () {
      const found = yield* (yield* Catalog).search("last loaded")

      expect(found.map((match) => match.indicator)).toEqual(["TEST.599"])
    }).pipe(Effect.provide(catalogOver(worldBank({ up: true }, many).layer)))
  })

  it.effect("asks the World Bank again once the catalog is a week old", () => {
    const source = worldBank({ up: true })

    return Effect.gen(function* () {
      const catalog = yield* Catalog

      yield* catalog.search("population")
      yield* TestClock.adjust("8 days")
      yield* catalog.search("population")

      expect(source.requests()).toBe(2)
    }).pipe(Effect.provide(catalogOver(source.layer)))
  })

  it.effect("keeps serving a week-old catalog while the World Bank is down", () => {
    const answers = { up: true }

    return Effect.gen(function* () {
      const catalog = yield* Catalog

      yield* catalog.search("life")
      answers.up = false
      yield* TestClock.adjust("8 days")

      expect(names(yield* catalog.search("life"))).toEqual([
        "Life expectancy at birth, total (years)",
      ])
    }).pipe(Effect.provide(catalogOver(worldBank(answers).layer)))
  })

  it.effect(
    "fails with SourceUnavailable when the catalog is empty and the World Bank is down",
    () =>
      Effect.gen(function* () {
        const error = yield* (yield* Catalog).search("population").pipe(Effect.flip)

        expect(error).toBeInstanceOf(SourceUnavailable)
      }).pipe(Effect.provide(catalogOver(worldBank({ up: false }).layer))),
  )
})
