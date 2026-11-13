import { beforeEach, describe, expect, it } from "@effect/vitest"
import { type CatalogEntry, CatalogUnavailable } from "@repo/domain"
import { reset } from "cloudflare:test"
import { Effect } from "effect"

import { Catalog } from "../Catalog.ts"
import {
  build,
  catalogOver,
  drop,
  listings,
  overloaded,
  planned,
  served,
  vectorize,
  workersAi,
  worldBankList,
} from "./catalog.ts"

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

  it.live("reads again when D1 refuses a read as overloaded", () =>
    Effect.gen(function* () {
      yield* build(1)

      const found = yield* Catalog.use((catalog) => catalog.search("youth unemploy")).pipe(
        Effect.provide(overloaded({ refusals: 1 })),
      )

      expect(names(found)).toEqual([
        "Unemployment, youth total (% of total labor force ages 15-24)",
      ])
    }).pipe(Effect.provide(catalogOver(listings()))),
  )

  it.live(
    "fails with CatalogUnavailable while D1 refuses every read as overloaded",
    () =>
      Effect.gen(function* () {
        yield* build(1)

        const catalog = Catalog.use((each) =>
          Effect.all([
            each.search("youth unemploy").pipe(Effect.flip),
            each.outlines([]).pipe(Effect.flip),
          ]),
        )

        const [searched, outlined] = yield* catalog.pipe(
          Effect.provide(overloaded({ refusals: Number.POSITIVE_INFINITY })),
        )

        expect(searched).toBeInstanceOf(CatalogUnavailable)
        expect(outlined).toBeInstanceOf(CatalogUnavailable)
      }).pipe(Effect.provide(catalogOver(listings()))),
    15_000,
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

  it.effect("looks each neighbour up by its indicator", () => {
    const { index } = vectorize()
    const reads = planned({ index })

    return Effect.gen(function* () {
      yield* build(1)

      const found = yield* Catalog.use((catalog) => catalog.search("how rich")).pipe(
        Effect.provide(reads.layer),
      )

      expect(names(found)).toHaveLength(2)

      // Only the neighbour lookup reads a list of codes.
      const neighbours = (yield* reads.plans).filter(({ query }) => query.includes("json_each"))

      expect(neighbours).toHaveLength(1)
      // Matching each code as a phrase reads the full-text postings of
      // tokens many codes share ("oecd", "dsd", "1").
      expect(neighbours[0]?.steps).toContain("SEARCH indexed USING PRIMARY KEY (indicator=?)")
      expect(neighbours[0]?.steps).not.toContain("SCAN catalog VIRTUAL TABLE INDEX 0:M5")
    }).pipe(Effect.provide(catalogOver(listings(), { index })))
  })

  it.effect("finds neighbours in a catalog built before neighbours had their own table", () => {
    const lists = listings()
    const { index } = vectorize()

    // Each build makes its layers anew, as a deployed Workflow step does.
    const over = catalogOver(lists, { index })

    const search = (text: string) =>
      Catalog.use((catalog) => catalog.search(text)).pipe(Effect.provide(served({ index })))

    return Effect.gen(function* () {
      yield* build(1).pipe(Effect.provide(over))
      yield* drop("catalog_indicator")

      // Words still answer until the next build.
      expect(yield* search("how rich")).toEqual([])
      expect(names(yield* search("life expectancy"))).toEqual([
        "Life expectancy at birth, total (years)",
      ])

      // Nothing changed, so this build publishes nothing.
      yield* build(2).pipe(Effect.provide(over))

      expect(names(yield* search("how rich")).toSorted()).toEqual([
        "GDP per capita (current US$)",
        "Income share held by highest 10%",
      ])
    })
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
