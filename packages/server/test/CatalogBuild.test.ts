import { type CatalogEntry, IndicatorId, Source, SourceUnavailable } from "@civicdata/domain"
import { beforeEach, describe, expect, it } from "@effect/vitest"
import { reset } from "cloudflare:test"
import { Deferred, Effect, Match, Schema } from "effect"
import { TestClock } from "effect/testing"

import { Catalog } from "../src/Catalog.ts"
import { BuildFailed, CatalogBuild } from "../src/CatalogBuild.ts"
import { Directions } from "../src/Directions.ts"
import {
  build,
  catalogOver,
  classified,
  drop,
  entry,
  exec,
  listings,
  published,
  stored,
  vectorize,
  workersAi,
  worldBankList,
} from "./catalog.ts"
import { chose, decisions, refused } from "./decisions.ts"
import { steps } from "./fakes.ts"

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

const Json = Schema.fromJsonString(Schema.Unknown)

// A direction gpt-6-luna gave, as stored.
const luna = (indicator: string, direction: string) => ({
  indicator,
  direction,
  model: "gpt-6-luna",
})

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

      yield* CatalogBuild.run({ id: "build 2", generation: 2 }).pipe(
        Effect.provide(steps(look).layer),
      )

      expect(seen[0]).toContain("Population, total")
      expect(names(yield* catalog.search("population")).toSorted()).toEqual([
        "Population on 1 January",
        "Population, newly listed",
      ])
    }).pipe(Effect.provide(catalogOver(lists)))
  })

  it.effect("runs each source's outline, label, write, embed and publish steps", () => {
    const run = steps()

    return Effect.gen(function* () {
      yield* CatalogBuild.run({ id: "build 1", generation: 1 }).pipe(Effect.provide(run.layer))

      expect(run.ran().filter((name) => name.endsWith("OECD"))).toEqual([
        "outline OECD",
        "describe OECD",
        "write OECD",
        "publish OECD",
      ])
      // The OECD's one step of codelists.
      expect(run.ran().filter((name) => name.startsWith("label OECD"))).toEqual([
        "label OECD after ",
      ])
      expect(run.ran().filter((name) => name.startsWith("label Eurostat"))).toEqual([
        "label Eurostat after ",
        "label Eurostat after ESTAT:UNIT",
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

      yield* CatalogBuild.run({ id: "build 2", generation: 2 }).pipe(Effect.provide(run.layer))

      // Each source's one classify step finds every entry classified, and
      // each label step every code labelled.
      expect(run.ran().toSorted()).toEqual([
        "classify Eurostat after 0",
        "classify OECD after 0",
        "classify World Bank after 0",
        "describe Eurostat",
        "describe OECD",
        "label Eurostat after ",
        "label OECD after ",
        "lease after 0 waits",
        "outline Eurostat",
        "outline OECD",
        "release the lease",
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

        const error = yield* CatalogBuild.run({ id: "build 2", generation: 2 }).pipe(
          Effect.provide(run.layer),
          Effect.flip,
        )

        expect(error).toEqual(new BuildFailed({ sources: ["World Bank"] }))

        yield* CatalogBuild.run({ id: "build 2", generation: 2 }).pipe(Effect.provide(run.layer))

        expect(upserts().slice(embedded)).toEqual([2])
        expect(deletes()).toEqual([["SI.DST.10TH.10"]])
        expect(names(yield* (yield* Catalog).search("how rich"))).toEqual([
          "GDP per capita, revised",
        ])
      }).pipe(Effect.provide(catalogOver(lists, { index })))
    })
  }

  // CI starts a build on every deploy, on top of the weekly one, so two can
  // run at once: an older one listing what the previous deploy lists, and a
  // newer one that also lists a child mortality rate. The older one publishes
  // and removes the vectors its listing drops while the newer one has
  // embedded the rate but not yet published it.
  it.effect("keeps the vectors a newer build embeds while an older build publishes", () => {
    const { index } = vectorize()
    const mortality = entry("SH.DYN.MORT", "Mortality rate, under-five (per 1,000 live births)")

    return Effect.gen(function* () {
      const olderWrites = yield* Deferred.make<void>()
      const newerWaits = yield* Deferred.make<void>()
      const olderRemoved = yield* Deferred.make<void>()

      // The older build publishes once the newer one has embedded, and
      // signals once it has removed.
      const older = steps((name) =>
        Match.value(name).pipe(
          Match.when("write World Bank", () => Deferred.succeed(olderWrites, undefined)),
          Match.when("publish World Bank", () => Deferred.await(newerWaits)),
          Match.when("classify World Bank after 0", () =>
            Deferred.succeed(olderRemoved, undefined),
          ),
          Match.orElse(() => Effect.void),
          Effect.asVoid,
        ),
      )

      // The newer build stops before publishing, or before waiting for the
      // older one, until the older one has published and removed.
      const newer = steps((name) =>
        Match.value(name).pipe(
          Match.when("publish World Bank", () =>
            Deferred.succeed(newerWaits, undefined).pipe(
              Effect.andThen(Deferred.await(olderRemoved)),
            ),
          ),
          Match.when(
            (step) => step.startsWith("wait"),
            () => Deferred.succeed(newerWaits, undefined),
          ),
          Match.orElse(() => Effect.void),
          Effect.asVoid,
        ),
      )

      yield* Effect.all(
        [
          CatalogBuild.run({ id: "build 1", generation: 1 }).pipe(
            Effect.provide([older.layer, catalogOver(listings(), { index })], { local: true }),
          ),
          Deferred.await(olderWrites).pipe(
            Effect.andThen(CatalogBuild.run({ id: "build 2", generation: 2 })),
            // Local, so this build lists what its own sources list rather
            // than sharing the other build's CatalogBuild.
            Effect.provide(
              [
                newer.layer,
                catalogOver(listings({ "World Bank": [...worldBankList, mortality] }), { index }),
              ],
              { local: true },
            ),
          ),
        ],
        { concurrency: "unbounded" },
      )

      expect(names(yield* (yield* Catalog).search("kids"))).toEqual([mortality.name])
    }).pipe(Effect.provide(catalogOver(listings(), { index })))
  })

  it.effect("lends the lease to one Workflow instance until it releases it or it expires", () =>
    Effect.gen(function* () {
      const catalog = yield* CatalogBuild

      expect(yield* catalog.take("first")).toBe(true)
      expect(yield* catalog.take("second")).toBe(false)
      // A replayed step takes it again, and only its holder releases it.
      expect(yield* catalog.take("first")).toBe(true)
      yield* catalog.release("second")
      expect(yield* catalog.take("second")).toBe(false)

      yield* catalog.release("first")
      yield* catalog.release("first")

      expect(yield* catalog.take("second")).toBe(true)

      // A build that crashed never releases it.
      yield* TestClock.adjust("12 hours")

      expect(yield* catalog.take("third")).toBe(true)
    }).pipe(Effect.provide(catalogOver(listings()))),
  )

  it.effect("removes no vector a newer generation lists before it is published", () => {
    const lists = listings()
    const { index, deletes } = vectorize()
    const mortality = entry("SH.DYN.MORT", "Mortality rate, under-five (per 1,000 live births)")

    return Effect.gen(function* () {
      const catalog = yield* CatalogBuild

      yield* catalog.write("World Bank", 1)
      yield* catalog.embed("World Bank", { generation: 1, after: 0 })
      lists["World Bank"] = [...worldBankList, mortality]
      yield* catalog.write("World Bank", 2)
      yield* catalog.embed("World Bank", { generation: 2, after: 0 })
      yield* catalog.publish("World Bank", 1)

      expect(yield* catalog.remove("World Bank")).toBe(0)

      yield* catalog.publish("World Bank", 2)

      expect(deletes()).toEqual([])
      expect(names(yield* (yield* Catalog).search("kids"))).toEqual([mortality.name])
    }).pipe(Effect.provide(catalogOver(lists, { index })))
  })

  it.effect("embeds nothing for an older build that runs after a newer one published", () => {
    const lists = listings()
    const { index, upserts } = vectorize()

    return Effect.gen(function* () {
      lists["World Bank"] = edited
      yield* build(2)
      const embedded = upserts().length

      lists["World Bank"] = worldBankList
      yield* build(1)

      expect(upserts()).toHaveLength(embedded)
      expect(names(yield* (yield* Catalog).search("how rich"))).toEqual(["GDP per capita, revised"])
    }).pipe(Effect.provide(catalogOver(lists, { index })))
  })

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
    const population = IndicatorId.make("SP.POP.TOTL")
    const growth = IndicatorId.make("SP.POP.GROW")
    const residents = IndicatorId.make("ESTAT,TPS00001,1.0")

    it.effect("stores one direction per indicator, from one request per source", () => {
      const wire = decisions()

      return Effect.gen(function* () {
        yield* build(1)

        // The income share's Lower came below the confidence threshold.
        expect(yield* classified).toEqual([
          luna("ESTAT,TPS00001,1.0", "Neutral"),
          luna("ESTAT,UNE_RT_A,1.0", "Lower"),
          luna("NY.GDP.PCAP.CD", "Higher"),
          luna("OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0", "Lower"),
          luna("SH.MED.SAOP.P5", "Higher"),
          luna("SI.DST.10TH.10", "Neutral"),
          luna("SL.UEM.1524.ZS", "Lower"),
          luna("SL.UEM.TOTL.ZS", "Lower"),
          luna("SP.DYN.LE00.IN", "Higher"),
          luna("SP.POP.GROW", "Neutral"),
          luna("SP.POP.TOTL", "Neutral"),
        ])
        // One request per source: Eurostat lists 2, the OECD 1, the World Bank 8.
        expect(wire.asked().map((asked) => asked.length)).toEqual(expect.arrayContaining([1, 2, 8]))
        expect(wire.asked()).toHaveLength(3)
      }).pipe(Effect.provide(catalogOver(listings(), { classifier: wire.classifier })))
    })

    it.effect("asks a choice question per entry, with the rules in a developer message", () => {
      const wire = decisions()
      const long = entry("LONG.1", "A long definition", "x".repeat(500))

      return Effect.gen(function* () {
        const catalog = yield* CatalogBuild

        yield* catalog.write("World Bank", 1)
        yield* catalog.publish("World Bank", 1)
        yield* catalog.classify("World Bank", 0)

        const [body, ...more] = wire.sent()

        expect(more).toEqual([])
        expect(yield* Schema.decodeEffect(Json)(body ?? "")).toEqual({
          model: "gpt-6-luna",
          input: [{ role: "developer", content: expect.stringContaining("When in doubt") }],
          questions: [
            {
              type: "choice",
              name: "LONG.1",
              // The definition cut to 400 characters.
              instructions: JSON.stringify({
                indicator: "LONG.1",
                name: "A long definition",
                definition: "x".repeat(400),
              }),
              choices: [
                { value: "Higher", description: expect.any(String) },
                { value: "Lower", description: expect.any(String) },
                { value: "Neutral", description: expect.any(String) },
              ],
            },
          ],
        })
      }).pipe(
        Effect.provide(
          catalogOver(listings({ "World Bank": [long] }), { classifier: wire.classifier }),
        ),
      )
    })

    it.effect(
      "stores Neutral for an answer below the threshold, a refusal, a missing answer and one outside the three",
      () => {
        const wire = decisions({
          answers: {
            [richest]: chose(richest, "Lower", 0.79),
            [surgeons]: refused(surgeons),
            [population]: chose(population, "Higher", 0.99),
            [growth]: chose(growth, "Better", 0.99),
            [residents]: chose(residents, "Higher", 0.8),
            [unemployment]: chose(unemployment, "Higher", 0.99),
          },
          missing: [population],
        })

        return Effect.gen(function* () {
          yield* build(1)

          const rows = new Map(
            (yield* classified).map((row) => [String(row["indicator"]), row["direction"]]),
          )

          expect(
            [richest, surgeons, population, growth, residents].map((one) => rows.get(one)),
          ).toEqual(["Neutral", "Neutral", "Neutral", "Neutral", "Higher"])
          // The hand-checked list wins over the model.
          expect(yield* read([unemployment])).toEqual(["Lower"])
        }).pipe(Effect.provide(catalogOver(listings(), { classifier: wire.classifier })))
      },
    )

    it.effect("stores nothing when a request fails, and still publishes the catalog", () => {
      const state = { up: false }
      const wire = decisions({ state })

      return Effect.gen(function* () {
        yield* build(1)

        expect(yield* published()).toHaveLength(3)
        expect(names(yield* (yield* Catalog).search("life expectancy"))).toEqual([
          "Life expectancy at birth, total (years)",
        ])
        expect(yield* classified).toEqual([])

        // The next build, with the API back, classifies them.
        state.up = true
        yield* build(2)

        expect(yield* read([surgeons, richest])).toEqual(["Higher", "Neutral"])
        expect(yield* classified).toHaveLength(11)
      }).pipe(Effect.provide(catalogOver(listings(), { classifier: wire.classifier })))
    })

    it.effect("asks again about a direction another model stored, and not one it stored", () => {
      const wire = decisions()

      return Effect.gen(function* () {
        yield* build(1)
        const first = wire.asked().length

        yield* exec(
          `UPDATE catalog_direction SET model = 'gpt-6.1-terra' WHERE indicator = '${surgeons}'`,
        )
        yield* build(2)

        expect(wire.asked().slice(first)).toEqual([[surgeons]])
      }).pipe(Effect.provide(catalogOver(listings(), { classifier: wire.classifier })))
    })

    it.effect("keeps the directions of a table an earlier version made until it asks again", () => {
      const wire = decisions()

      return Effect.gen(function* () {
        yield* exec(
          [
            "CREATE TABLE catalog_direction (indicator TEXT PRIMARY KEY, name TEXT NOT NULL, definition TEXT NOT NULL, direction TEXT NOT NULL)",
            `INSERT INTO catalog_direction VALUES ('${surgeons}', 'Specialist surgical workforce (per 100,000 population)', '', 'Lower')`,
          ].join("\n"),
        )

        expect(yield* read([surgeons])).toEqual(["Lower"])

        yield* build(1).pipe(
          Effect.provide(catalogOver(listings(), { classifier: wire.classifier })),
        )

        expect(wire.asked().flat()).toContain(surgeons)
        expect(yield* read([surgeons])).toEqual(["Higher"])
      })
    })

    it.effect("makes no request when a second build finds nothing new", () => {
      const wire = decisions()

      return Effect.gen(function* () {
        yield* build(1)
        const first = wire.asked().length

        yield* build(2)

        expect(first).toBeGreaterThan(0)
        expect(wire.asked()).toHaveLength(first)
      }).pipe(Effect.provide(catalogOver(listings(), { classifier: wire.classifier })))
    })

    it.effect("asks again about an entry whose definition changed, and only it", () => {
      const lists = listings()
      const wire = decisions()

      return Effect.gen(function* () {
        yield* build(1)
        const first = wire.asked().length

        lists["World Bank"] = worldBankList.map((each) =>
          each.indicator === unemployment
            ? entry(each.indicator, each.name, "Share of the labor force without work, revised.")
            : each,
        )
        yield* build(2)

        expect(wire.asked().slice(first)).toEqual([[unemployment]])
      }).pipe(Effect.provide(catalogOver(lists, { classifier: wire.classifier })))
    })

    it.effect("stores nothing with classification off, and still publishes the catalog", () =>
      Effect.gen(function* () {
        yield* build(1)

        expect(yield* published()).toHaveLength(3)
        expect(yield* classified).toEqual([])
        // Only the hand-checked list colours.
        expect(yield* read([surgeons, unemployment])).toEqual(["Neutral", "Lower"])
      }).pipe(Effect.provide(catalogOver(listings()))),
    )

    it.effect("classifies a source in requests of 400 and resumes after losing a step", () => {
      const wire = decisions()
      const run = steps(undefined, { lose: "classify World Bank after 0" })

      return Effect.gen(function* () {
        const failed = yield* CatalogBuild.run({ id: "build 1", generation: 1 }).pipe(
          Effect.provide(run.layer),
          Effect.flip,
        )

        expect(failed).toEqual(new BuildFailed({ sources: ["World Bank"] }))

        yield* CatalogBuild.run({ id: "build 1", generation: 1 }).pipe(Effect.provide(run.layer))

        const sizes = wire
          .asked()
          .filter((asked) => asked.some((indicator) => indicator.startsWith("TEST.")))
          .map((asked) => asked.length)

        // The lost step's 400 were stored before it was lost, so the resumed
        // build asks about the other 500 only.
        expect(sizes).toEqual([400, 400, 100])
      }).pipe(
        Effect.provide(
          catalogOver(listings({ "World Bank": many(900) }), { classifier: wire.classifier }),
        ),
      )
    })
  })
})
