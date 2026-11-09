import { type CatalogEntry, IndicatorId, SourceUnavailable } from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
import { beforeEach, describe, expect, it } from "@effect/vitest"
import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"

import { Catalog } from "../src/Catalog.ts"
import { type Ai, type Index, Vectors } from "../src/Vectors.ts"
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
  entry(
    "NY.GDP.PCAP.CD",
    "GDP per capita (current US$)",
    "Gross domestic product divided by the number of people.",
  ),
  entry("SI.DST.10TH.10", "Income share held by highest 10%"),
]

// A World Bank whose indicator list the test controls, counting the times it
// was asked.
const worldBank = (answers: { up: boolean; indicators?: ReadonlyArray<CatalogEntry> }) => {
  let requests = 0

  const layer = Layer.succeed(
    WorldBank,
    WorldBank.of({
      describe: () => Effect.die("not used by the catalog"),
      observations: () => Effect.die("not used by the catalog"),
      indicators: Effect.suspend(() => {
        requests += 1

        return answers.up
          ? Effect.succeed(answers.indicators ?? published)
          : Effect.fail(new SourceUnavailable({ source: "World Bank" }))
      }),
    }),
  )

  return { layer, requests: () => requests }
}

const db = env.DB

if (db === undefined) throw new Error("vitest.config.ts must bind a D1 database as DB")

// Workers AI as a dictionary: a text's vector marks the topics it mentions,
// so "how rich" lands next to "GDP per capita" and unrelated text next to
// nothing.
const topics = [/\brich\b|per capita|income/i, /\bkids\b|under-five/i]

const workersAi = (answers: { up: boolean }): Ai => ({
  run: (_model, { text }) =>
    answers.up
      ? Promise.resolve({
          data: text.map((one) => topics.map((topic) => (topic.test(one) ? 1 : 0))),
        })
      : Promise.reject(new Error("Workers AI is down")),
})

const cosine = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) => {
  const dot = a.reduce((sum, value, at) => sum + value * (b[at] ?? 0), 0)
  const norms = Math.hypot(...a) * Math.hypot(...b)

  return norms === 0 ? 0 : dot / norms
}

// A Vectorize index in memory, recording how many vectors each upsert stored.
const vectorize = () => {
  const stored = new Map<string, ReadonlyArray<number>>()
  const upserts: Array<number> = []

  const index: Index = {
    upsert: (vectors) => {
      upserts.push(vectors.length)

      for (const { id, values } of vectors) stored.set(id, values)

      return Promise.resolve({ mutationId: String(upserts.length) })
    },
    query: (vector, { topK }) =>
      Promise.resolve({
        count: Math.min(topK, stored.size),
        matches: [...stored]
          .map(([id, values]) => ({ id, score: cosine(vector, values) }))
          .toSorted((a, b) => b.score - a.score)
          .slice(0, topK),
      }),
  }

  return { index, upserts: () => upserts }
}

// The real catalog over the test Worker's local D1 database, with Workers AI
// and Vectorize faked at their bindings.
const catalogOver = (
  source: Layer.Layer<WorldBank>,
  { ai = workersAi({ up: true }), index = vectorize().index }: { ai?: Ai; index?: Index } = {},
) =>
  Catalog.layer.pipe(
    Layer.provide(source),
    Layer.provide(Vectors.cloudflare({ ai, index })),
    Layer.provide(D1Client.layer({ db }).pipe(Layer.orDie)),
  )

// The test Worker's D1 database is shared by the tests in this file.
beforeEach(async () => {
  await db.exec(
    "DROP TABLE IF EXISTS catalog; DROP TABLE IF EXISTS catalog_refresh; DROP TABLE IF EXISTS catalog_embedded;",
  )
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
    }).pipe(Effect.provide(catalogOver(worldBank({ up: true, indicators: many }).layer)))
  })

  it.effect("finds an indicator by meaning when none of its words match", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog

      // The first search loads the catalog and embeds it.
      expect(yield* catalog.search("how rich")).toEqual([])
      expect(names(yield* catalog.search("how rich")).toSorted()).toEqual([
        "GDP per capita (current US$)",
        "Income share held by highest 10%",
      ])
    }).pipe(Effect.provide(catalogOver(worldBank({ up: true }).layer))),
  )

  it.effect("ranks an indicator found by its words and by meaning first", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog

      yield* catalog.search("income")

      expect(names(yield* catalog.search("income"))).toEqual([
        "Income share held by highest 10%",
        "GDP per capita (current US$)",
      ])
    }).pipe(Effect.provide(catalogOver(worldBank({ up: true }).layer))),
  )

  it.effect("embeds at most 50 entries per search, until the catalog is embedded", () => {
    const many = Array.from({ length: 120 }, (_, index) =>
      entry(`TEST.${index}`, `Indicator ${index}`),
    )

    const { index, upserts } = vectorize()

    return Effect.gen(function* () {
      const catalog = yield* Catalog

      for (const _ of Array.from({ length: 4 })) yield* catalog.search("indicator")

      expect(upserts()).toEqual([50, 50, 20])
    }).pipe(Effect.provide(catalogOver(worldBank({ up: true, indicators: many }).layer, { index })))
  })

  it.effect("drops an indicator that left the catalog from meaning search", () => {
    const answers = { up: true, indicators: published }

    return Effect.gen(function* () {
      const catalog = yield* Catalog

      yield* catalog.search("how rich")
      answers.indicators = published.filter(({ name }) => !name.startsWith("GDP"))
      yield* TestClock.adjust("8 days")

      expect(names(yield* catalog.search("how rich"))).toEqual(["Income share held by highest 10%"])
    }).pipe(Effect.provide(catalogOver(worldBank(answers).layer)))
  })

  it.effect("searches by words while Workers AI is down", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog

      yield* catalog.search("how rich")

      expect(yield* catalog.search("how rich")).toEqual([])
      expect(names(yield* catalog.search("life expectancy"))).toEqual([
        "Life expectancy at birth, total (years)",
      ])
    }).pipe(
      Effect.provide(catalogOver(worldBank({ up: true }).layer, { ai: workersAi({ up: false }) })),
    ),
  )

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
