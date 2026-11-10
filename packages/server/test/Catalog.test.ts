import { type CatalogEntry, CatalogUnavailable } from "@civicdata/domain"
import { beforeEach, describe, expect, it } from "@effect/vitest"
import { reset } from "cloudflare:test"
import { Effect } from "effect"

import { Catalog } from "../src/Catalog.ts"
import { build, catalogOver, listings, vectorize, workersAi, worldBankList } from "./catalog.ts"

// Every test starts from empty bindings: the test Worker's D1 database and
// buckets are shared by the file's tests.
beforeEach(() => reset())

const names = (entries: ReadonlyArray<CatalogEntry>) => entries.map((found) => found.name)

describe("Catalog", () => {
  it.effect("fails with CatalogUnavailable until a build publishes the catalog", () =>
    Effect.gen(function* () {
      const error = yield* (yield* Catalog).search("population").pipe(Effect.flip)

      expect(error).toBeInstanceOf(CatalogUnavailable)
    }).pipe(Effect.provide(catalogOver(listings()))),
  )

  it.effect("ranks name matches first", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog

      yield* build(1)

      expect(names(yield* catalog.search("youth unemploy"))).toEqual([
        "Unemployment, youth total (% of total labor force ages 15-24)",
      ])
      // A match in the name outranks one only in the definition.
      const population = names(yield* catalog.search("Population"))

      expect(population.slice(0, 4).toSorted()).toEqual([
        "Population growth (annual %)",
        "Population on 1 January",
        "Population, total",
        "Specialist surgical workforce (per 100,000 population)",
      ])
      expect(population[4]).toBe("Life expectancy at birth, total (years)")
    }).pipe(Effect.provide(catalogOver(listings()))),
  )

  it.effect("finds Eurostat and OECD dataflows next to World Bank indicators", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog

      yield* build(1)

      expect(names(yield* catalog.search("unemployment")).toSorted()).toEqual([
        "Monthly unemployment rates",
        "Unemployment by sex and age - annual data",
        "Unemployment, total (% of total labor force)",
        "Unemployment, youth total (% of total labor force ages 15-24)",
      ])
    }).pipe(Effect.provide(catalogOver(listings()))),
  )

  it.effect("searches one source's indicators when asked", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog

      yield* build(1)

      expect(names(yield* catalog.search("unemployment", { source: "OECD" }))).toEqual([
        "Monthly unemployment rates",
      ])
      expect(names(yield* catalog.search("how rich", { source: "Eurostat" }))).toEqual([])
    }).pipe(Effect.provide(catalogOver(listings()))),
  )

  it.effect("fails with CatalogUnavailable for a source no build has published", () => {
    const lists = listings({ OECD: "down" })

    return Effect.gen(function* () {
      const catalog = yield* Catalog

      yield* build(1).pipe(Effect.flip)

      expect(
        yield* catalog.search("unemployment", { source: "OECD" }).pipe(Effect.flip),
      ).toBeInstanceOf(CatalogUnavailable)
      // A search of every source answers from those published.
      expect(names(yield* catalog.search("unemployment")).toSorted()).toEqual([
        "Unemployment by sex and age - annual data",
        "Unemployment, total (% of total labor force)",
        "Unemployment, youth total (% of total labor force ages 15-24)",
      ])
    }).pipe(Effect.provide(catalogOver(lists)))
  })

  it.effect("ranks indicators whose code starts with the search first", () =>
    Effect.gen(function* () {
      yield* build(1)

      const found = yield* (yield* Catalog).search("SP.POP")

      expect(
        found
          .slice(0, 2)
          .map((match) => match.indicator)
          .toSorted(),
      ).toEqual(["SP.POP.GROW", "SP.POP.TOTL"])
      expect(found.map((match) => match.indicator)).toContain("SH.MED.SAOP.P5")
    }).pipe(Effect.provide(catalogOver(listings()))),
  )

  it.effect("finds an indicator by meaning when none of its words match", () =>
    Effect.gen(function* () {
      yield* build(1)

      expect(names(yield* (yield* Catalog).search("how rich")).toSorted()).toEqual([
        "GDP per capita (current US$)",
        "Income share held by highest 10%",
      ])
    }).pipe(Effect.provide(catalogOver(listings()))),
  )

  it.effect("ranks an indicator found by its words and by meaning first", () =>
    Effect.gen(function* () {
      yield* build(1)

      expect(names(yield* (yield* Catalog).search("income"))).toEqual([
        "Income share held by highest 10%",
        "GDP per capita (current US$)",
      ])
    }).pipe(Effect.provide(catalogOver(listings()))),
  )

  it.effect("drops an indicator that left the catalog from meaning search", () => {
    const lists = listings()

    return Effect.gen(function* () {
      yield* build(1)
      lists["World Bank"] = worldBankList.filter(({ name }) => !name.startsWith("GDP"))
      yield* build(2)

      expect(names(yield* (yield* Catalog).search("how rich"))).toEqual([
        "Income share held by highest 10%",
      ])
    }).pipe(Effect.provide(catalogOver(lists)))
  })

  it.effect("searches by words while Workers AI is down", () => {
    const ai = { up: true }

    return Effect.gen(function* () {
      yield* build(1)
      ai.up = false

      const catalog = yield* Catalog

      expect(yield* catalog.search("how rich")).toEqual([])
      expect(names(yield* catalog.search("life expectancy"))).toEqual([
        "Life expectancy at birth, total (years)",
      ])
    }).pipe(Effect.provide(catalogOver(listings(), { ai: workersAi(ai) })))
  })

  it.effect("embeds nothing while searching", () => {
    const { index, upserts } = vectorize()

    return Effect.gen(function* () {
      yield* build(1)

      const embedded = upserts().length

      yield* (yield* Catalog).search("population")

      expect(upserts()).toHaveLength(embedded)
    }).pipe(Effect.provide(catalogOver(listings(), { index })))
  })
})
