import { type CatalogEntry, IndicatorId, Source, SourceUnavailable } from "@civicdata/domain"
import { beforeEach, describe, expect, it } from "@effect/vitest"
import { reset } from "cloudflare:test"
import { Effect } from "effect"

import { Catalog } from "../src/Catalog.ts"
import { BuildFailed, CatalogBuild } from "../src/CatalogBuild.ts"
import { Directions } from "../src/Directions.ts"
import {
  build,
  catalogOver,
  drop,
  entry,
  listings,
  published,
  stored,
  vectorize,
  workersAi,
  worldBankList,
} from "./catalog.ts"
import { steps } from "./fakes.ts"
import { fakeModel } from "./model.ts"

// Every test starts from empty bindings: the test Worker's D1 database and
// buckets are shared by the file's tests.
beforeEach(() => reset())

const names = (entries: ReadonlyArray<CatalogEntry>) => entries.map((found) => found.name)

// An entry of each source's list in generation 1.
const kept: Record<Source, string> = {
  "World Bank": "Life expectancy at birth, total (years)",
  Eurostat: "Population on 1 January",
  OECD: "Monthly unemployment rates",
}

// The World Bank's list with GDP per capita renamed, a child mortality rate
// added and the income share dropped. Workers AI's fake embeds "rich" and
// "kids", so a search by meaning finds each.
const edited = [
  ...worldBankList.filter(
    ({ indicator }) => indicator !== "SI.DST.10TH.10" && indicator !== "NY.GDP.PCAP.CD",
  ),
  entry(
    "NY.GDP.PCAP.CD",
    "GDP per capita, revised",
    "Gross domestic product divided by the number of people.",
  ),
  entry("SH.DYN.MORT", "Mortality rate, under-five (per 1,000 live births)"),
]

// Each indicator's direction, as charts read it.
const read = (indicators: ReadonlyArray<IndicatorId>) =>
  Effect.gen(function* () {
    const directions = yield* Directions

    return yield* Effect.forEach(indicators, directions.of)
  }).pipe(Effect.provide(stored))

const many = (count: number) =>
  Array.from({ length: count }, (_, index) => entry(`TEST.${index}`, `Indicator ${index}`))

describe("CatalogBuild", () => {
  it.effect("writes a source's list into a generation, larger than one insert", () =>
    Effect.gen(function* () {
      const catalog = yield* CatalogBuild

      expect(yield* catalog.write("World Bank", 1)).toBe(600)
      // A retried write replaces what the failed attempt wrote.
      expect(yield* catalog.write("World Bank", 1)).toBe(600)
      yield* catalog.publish("World Bank", 1)

      expect(names(yield* (yield* Catalog).search("indicator 599"))).toEqual(["Indicator 599"])
    }).pipe(Effect.provide(catalogOver(listings({ "World Bank": many(600) })))),
  )

  it.effect("fails a write when the source lists nothing", () =>
    Effect.gen(function* () {
      const error = yield* (yield* CatalogBuild).write("Eurostat", 1).pipe(Effect.flip)

      expect(error).toEqual(new SourceUnavailable({ source: "Eurostat" }))
    }).pipe(Effect.provide(catalogOver(listings({ Eurostat: [] })))),
  )

  it.effect("embeds a generation 100 entries at a time, then answers null", () => {
    const { index, upserts } = vectorize()

    return Effect.gen(function* () {
      const catalog = yield* CatalogBuild

      yield* catalog.write("World Bank", 1)

      const first = yield* catalog.embed("World Bank", { generation: 1, after: 0 })
      const second = yield* catalog.embed("World Bank", { generation: 1, after: first ?? 0 })
      const done = yield* catalog.embed("World Bank", { generation: 1, after: second ?? 0 })

      expect(upserts()).toEqual([100, 20])
      expect(done).toBeNull()
    }).pipe(Effect.provide(catalogOver(listings({ "World Bank": many(120) }), { index })))
  })

  it.effect("publishes a generation and drops the source's older ones", () => {
    const lists = listings()

    return Effect.gen(function* () {
      const catalog = yield* CatalogBuild
      const search = (yield* Catalog).search

      yield* catalog.write("World Bank", 1)
      yield* catalog.publish("World Bank", 1)
      lists["World Bank"] = [entry("NEW.1", "Population, newly listed")]
      yield* catalog.write("World Bank", 2)

      // Written but not published: searches still read generation 1.
      expect(names(yield* search("population"))).toContain("Population, total")

      yield* catalog.publish("World Bank", 2)

      expect(names(yield* search("population"))).toEqual(["Population, newly listed"])

      // An older build that publishes late does not replace a newer one.
      yield* catalog.publish("World Bank", 1)

      expect(names(yield* search("population"))).toEqual(["Population, newly listed"])
    }).pipe(Effect.provide(catalogOver(lists)))
  })

  it.effect("serves the old generation until the build publishes the new one", () => {
    const lists = listings()

    return Effect.gen(function* () {
      const catalog = yield* Catalog

      yield* build(1)
      lists["World Bank"] = [entry("NEW.1", "Population, newly listed")]

      const seen: Array<ReadonlyArray<string>> = []

      const look = (name: string) =>
        name === "publish World Bank"
          ? catalog.search("population").pipe(Effect.map((found) => void seen.push(names(found))))
          : Effect.void

      yield* CatalogBuild.run(2).pipe(Effect.provide(steps(look).layer))

      expect(seen[0]).toContain("Population, total")
      expect(names(yield* catalog.search("population")).toSorted()).toEqual([
        "Population on 1 January",
        "Population, newly listed",
      ])
    }).pipe(Effect.provide(catalogOver(lists)))
  })

  it.effect("runs each source's write, embed and publish steps", () => {
    const run = steps()

    return Effect.gen(function* () {
      yield* CatalogBuild.run(1).pipe(Effect.provide(run.layer))

      expect(run.ran().filter((name) => name.endsWith("OECD"))).toEqual([
        "write OECD",
        "publish OECD",
      ])
      expect(run.ran().filter((name) => name.startsWith("embed OECD"))).toHaveLength(2)
    }).pipe(Effect.provide(catalogOver(listings())))
  })

  for (const down of Source.literals) {
    it.effect(`keeps ${down}'s old generation when it is down, and publishes the others`, () => {
      const lists = listings()

      return Effect.gen(function* () {
        const catalog = yield* Catalog

        yield* build(1)
        lists[down] = "down"
        lists[down === "World Bank" ? "Eurostat" : "World Bank"] = [
          entry(down === "World Bank" ? "ESTAT,NEW,1.0" : "NEW.1", "Newly listed"),
        ]

        const error = yield* build(2).pipe(Effect.flip)

        expect(error).toEqual(new BuildFailed({ sources: [down] }))
        expect(names(yield* catalog.search("newly listed"))).toEqual(["Newly listed"])
        // The source that was down still answers from generation 1.
        expect(names(yield* catalog.search(kept[down]))).toEqual([kept[down]])
      }).pipe(Effect.provide(catalogOver(lists)))
    })
  }

  it.effect("skips every source whose listing has not changed, embedding nothing", () => {
    const { index, upserts } = vectorize()
    const run = steps()

    return Effect.gen(function* () {
      yield* build(1)
      const embedded = upserts().length

      yield* CatalogBuild.run(2).pipe(Effect.provide(run.layer))

      // Each source's one classify step finds every entry classified.
      expect(run.ran().toSorted()).toEqual([
        "classify Eurostat after 0",
        "classify OECD after 0",
        "classify World Bank after 0",
        "write Eurostat",
        "write OECD",
        "write World Bank",
      ])
      expect(upserts()).toHaveLength(embedded)
      expect(yield* published()).toEqual([
        { source: "Eurostat", generation: 1 },
        { source: "OECD", generation: 1 },
        { source: "World Bank", generation: 1 },
      ])
      expect(names(yield* (yield* Catalog).search("life expectancy"))).toEqual([
        "Life expectancy at birth, total (years)",
      ])
    }).pipe(Effect.provide(catalogOver(listings(), { index })))
  })

  it.effect("rebuilds only the source with a changed entry", () => {
    const lists = listings()
    const { index, upserts } = vectorize()

    return Effect.gen(function* () {
      yield* build(1)
      lists.Eurostat = [
        entry("ESTAT,UNE_RT_A,1.0", "Unemployment by sex and age - annual data"),
        entry("ESTAT,TPS00001,1.0", "Population on 1 January, renamed"),
      ]
      const embedded = upserts().length

      yield* build(2)

      // The unemployment entry kept its vector.
      expect(upserts().slice(embedded)).toEqual([1])
      expect(yield* published()).toEqual([
        { source: "Eurostat", generation: 2 },
        { source: "OECD", generation: 1 },
        { source: "World Bank", generation: 1 },
      ])
      expect(names(yield* (yield* Catalog).search("renamed"))).toEqual([
        "Population on 1 January, renamed",
      ])
    }).pipe(Effect.provide(catalogOver(lists, { index })))
  })

  it.effect("rebuilds every source when the embedding model changes", () => {
    const lists = listings()
    const { index, upserts } = vectorize()

    return Effect.gen(function* () {
      yield* build(1).pipe(Effect.provide(catalogOver(lists, { index })))
      const embedded = upserts().length

      yield* build(2).pipe(Effect.provide(catalogOver(lists, { index, model: "@cf/other" })))

      expect(
        upserts()
          .slice(embedded)
          .toSorted((a, b) => a - b),
      ).toEqual([1, 2, 8])
      expect(yield* published()).toEqual([
        { source: "Eurostat", generation: 2 },
        { source: "OECD", generation: 2 },
        { source: "World Bank", generation: 2 },
      ])
    })
  })

  it.effect("rebuilds every source over tables an earlier version made", () => {
    const lists = listings()
    const { index, upserts } = vectorize()

    return Effect.gen(function* () {
      yield* build(1).pipe(Effect.provide(catalogOver(lists, { index })))
      // The catalog as the version before fingerprints left it.
      yield* drop("catalog_fingerprint", "catalog_vector")
      const embedded = upserts().length

      yield* build(2).pipe(Effect.provide(catalogOver(lists, { index })))

      expect(
        upserts()
          .slice(embedded)
          .toSorted((a, b) => a - b),
      ).toEqual([1, 2, 8])
      expect(yield* published()).toEqual([
        { source: "Eurostat", generation: 2 },
        { source: "OECD", generation: 2 },
        { source: "World Bank", generation: 2 },
      ])

      // The rebuild stored fingerprints, so the next build skips every source.
      yield* build(3).pipe(Effect.provide(catalogOver(lists, { index })))

      expect(upserts().slice(embedded)).toHaveLength(3)
    })
  })

  it.effect("keeps a changed source's old generation when Workers AI is down mid-build", () => {
    const lists = listings()
    const ai = { up: true }

    return Effect.gen(function* () {
      yield* build(1)
      lists["World Bank"] = edited
      ai.up = false

      const error = yield* build(2).pipe(Effect.flip)

      // Eurostat and OECD list what they did, so they need no Workers AI.
      expect(error).toEqual(new BuildFailed({ sources: ["World Bank"] }))
      expect(names(yield* (yield* Catalog).search("life expectancy"))).toEqual([
        "Life expectancy at birth, total (years)",
      ])
    }).pipe(Effect.provide(catalogOver(lists, { ai: workersAi(ai) })))
  })

  it.effect("embeds the new and edited entries and removes the dropped one's vector", () => {
    const lists = listings()
    const { index, upserts, deletes } = vectorize()

    return Effect.gen(function* () {
      const search = (yield* Catalog).search

      yield* build(1)
      lists["World Bank"] = edited
      const embedded = upserts().length

      yield* build(2)

      expect(upserts().slice(embedded)).toEqual([2])
      expect(deletes()).toEqual([["SI.DST.10TH.10"]])
      expect(names(yield* search("how rich"))).toEqual(["GDP per capita, revised"])
      expect(names(yield* search("kids"))).toEqual([
        "Mortality rate, under-five (per 1,000 live births)",
      ])
    }).pipe(Effect.provide(catalogOver(lists, { index })))
  })

  for (const lose of ["embed World Bank after 0", "remove World Bank after 0"]) {
    it.effect(`embeds and removes the same entries when it resumes after losing ${lose}`, () => {
      const lists = listings()
      const { index, upserts, deletes } = vectorize()
      const run = steps(undefined, { lose })

      return Effect.gen(function* () {
        yield* build(1)
        lists["World Bank"] = edited
        const embedded = upserts().length

        const error = yield* CatalogBuild.run(2).pipe(Effect.provide(run.layer), Effect.flip)

        expect(error).toEqual(new BuildFailed({ sources: ["World Bank"] }))

        yield* CatalogBuild.run(2).pipe(Effect.provide(run.layer))

        expect(upserts().slice(embedded)).toEqual([2])
        expect(deletes()).toEqual([["SI.DST.10TH.10"]])
        expect(names(yield* (yield* Catalog).search("how rich"))).toEqual([
          "GDP per capita, revised",
        ])
      }).pipe(Effect.provide(catalogOver(lists, { index })))
    })
  }

  it.effect("embeds a changed source in full once over the tables fingerprints made", () => {
    const lists = listings()
    const { index, upserts } = vectorize()

    return Effect.gen(function* () {
      yield* build(1).pipe(Effect.provide(catalogOver(lists, { index })))
      // The catalog as the version before catalog_vector left it.
      yield* drop("catalog_vector")
      lists["World Bank"] = edited
      const embedded = upserts().length

      yield* build(2).pipe(Effect.provide(catalogOver(lists, { index })))

      // Every entry the World Bank lists, since no build recorded its vectors.
      expect(upserts().slice(embedded)).toEqual([edited.length])

      lists["World Bank"] = [
        ...edited.filter(({ indicator }) => indicator !== "SP.POP.TOTL"),
        entry("SP.POP.TOTL", "Population, total", "Revised."),
      ]

      yield* build(3).pipe(Effect.provide(catalogOver(lists, { index })))

      expect(upserts().slice(embedded)).toEqual([edited.length, 1])
    })
  })

  describe("classifying directions", () => {
    // On the hand-checked list as Lower.
    const unemployment = IndicatorId.make("SL.UEM.TOTL.ZS")
    // Off the list.
    const surgeons = IndicatorId.make("SH.MED.SAOP.P5")
    const richest = IndicatorId.make("SI.DST.10TH.10")
    const growth = IndicatorId.make("SP.POP.GROW")
    const population = IndicatorId.make("SP.POP.TOTL")

    // What the model answers: a direction for two entries off the list, one
    // answer outside the three, one against the list, and the rest left out.
    const answers = {
      [surgeons]: "Higher",
      [richest]: "Lower",
      [growth]: "Better",
      [unemployment]: "Higher",
    }

    it.effect(
      "stores a direction for each new entry, Neutral for an answer outside the three",
      () => {
        const lists = listings()
        const model = fakeModel(answers)

        return Effect.gen(function* () {
          yield* build(1)

          // An answer outside the three and a left-out entry read Neutral, and
          // the hand-checked list wins over the model.
          expect(yield* read([surgeons, richest, growth, population, unemployment])).toEqual([
            "Higher",
            "Lower",
            "Neutral",
            "Neutral",
            "Lower",
          ])
          expect(model.asked().flat().toSorted()).toEqual(
            Source.literals
              .flatMap((source) => {
                const listed = lists[source]

                return listed === "down" ? [] : listed.map(({ indicator }) => indicator)
              })
              .toSorted(),
          )
        }).pipe(Effect.provide(catalogOver(lists, { classifier: model.classifier })))
      },
    )

    it.effect("asks the model nothing when a second build finds nothing changed", () => {
      const model = fakeModel(answers)

      return Effect.gen(function* () {
        yield* build(1)
        const first = model.asked().length

        yield* build(2)

        expect(first).toBeGreaterThan(0)
        expect(model.asked()).toHaveLength(first)
      }).pipe(Effect.provide(catalogOver(listings(), { classifier: model.classifier })))
    })

    it.effect("asks again about an entry whose definition changed, and only it", () => {
      const lists = listings()
      const model = fakeModel(answers)

      return Effect.gen(function* () {
        yield* build(1)
        const first = model.asked().length

        lists["World Bank"] = worldBankList.map((each) =>
          each.indicator === unemployment
            ? entry(each.indicator, each.name, "Share of the labor force without work, revised.")
            : each,
        )
        yield* build(2)

        expect(model.asked().slice(first)).toEqual([[unemployment]])
      }).pipe(Effect.provide(catalogOver(lists, { classifier: model.classifier })))
    })

    it.effect("publishes the catalog and leaves every entry Neutral when the model is down", () => {
      const state = { up: false }
      const model = fakeModel(answers, state)

      return Effect.gen(function* () {
        yield* build(1)

        expect(yield* published()).toHaveLength(3)
        expect(names(yield* (yield* Catalog).search("life expectancy"))).toEqual([
          "Life expectancy at birth, total (years)",
        ])
        expect(yield* read([surgeons, richest])).toEqual(["Neutral", "Neutral"])

        // The failed requests stored nothing, so the next build, with the
        // model back, classifies them.
        state.up = true
        yield* build(2)

        expect(yield* read([surgeons, richest])).toEqual(["Higher", "Lower"])
      }).pipe(Effect.provide(catalogOver(listings(), { classifier: model.classifier })))
    })

    it.effect("classifies a source in requests of 50 and resumes after losing a step", () => {
      const model = fakeModel()
      const run = steps(undefined, { lose: "classify World Bank after 0" })

      return Effect.gen(function* () {
        const failed = yield* CatalogBuild.run(1).pipe(Effect.provide(run.layer), Effect.flip)

        expect(failed).toEqual(new BuildFailed({ sources: ["World Bank"] }))

        yield* CatalogBuild.run(1).pipe(Effect.provide(run.layer))

        const sizes = model
          .asked()
          .filter((indicators) => indicators.some((indicator) => indicator.startsWith("TEST.")))
          .map((indicators) => indicators.length)

        // The lost step's 50 were stored before it was lost, so the resumed
        // build asks about the other 70 only.
        expect(sizes).toEqual([50, 50, 20])
      }).pipe(
        Effect.provide(
          catalogOver(listings({ "World Bank": many(120) }), { classifier: model.classifier }),
        ),
      )
    })
  })
})
