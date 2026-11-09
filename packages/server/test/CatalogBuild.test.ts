import { type CatalogEntry, Source, SourceUnavailable } from "@civicdata/domain"
import { beforeEach, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Catalog } from "../src/Catalog.ts"
import { BuildFailed, CatalogBuild } from "../src/CatalogBuild.ts"
import {
  build,
  catalogOver,
  dropFingerprints,
  emptyCatalog,
  entry,
  listings,
  published,
  vectorize,
  workersAi,
  worldBankList,
} from "./catalog.ts"
import { steps } from "./fakes.ts"

beforeEach(emptyCatalog)

const names = (entries: ReadonlyArray<CatalogEntry>) => entries.map((found) => found.name)

// An entry of each source's list in generation 1.
const kept: Record<Source, string> = {
  "World Bank": "Life expectancy at birth, total (years)",
  Eurostat: "Population on 1 January",
  OECD: "Monthly unemployment rates",
}

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

      expect(run.ran().toSorted()).toEqual(["write Eurostat", "write OECD", "write World Bank"])
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

      expect(upserts().slice(embedded)).toEqual([2])
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
      yield* dropFingerprints
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
      lists["World Bank"] = worldBankList.slice(0, 1)
      ai.up = false

      const error = yield* build(2).pipe(Effect.flip)

      // Eurostat and OECD list what they did, so they need no Workers AI.
      expect(error).toEqual(new BuildFailed({ sources: ["World Bank"] }))
      expect(names(yield* (yield* Catalog).search("life expectancy"))).toEqual([
        "Life expectancy at birth, total (years)",
      ])
    }).pipe(Effect.provide(catalogOver(lists, { ai: workersAi(ai) })))
  })
})
