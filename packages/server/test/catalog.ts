import { type CatalogEntry, IndicatorId, type Source, SourceUnavailable } from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"

import { Catalog } from "../src/Catalog.ts"
import { CatalogBuild, Step } from "../src/CatalogBuild.ts"
import { Classifier } from "../src/Classifier.ts"
import { Directions } from "../src/Directions.ts"
import { Sdmx } from "../src/Sdmx.ts"
import { type Ai, type Index, Vectors } from "../src/Vectors.ts"
import { WorldBank } from "../src/WorldBank.ts"

export const entry = (indicator: string, name: string, definition = ""): CatalogEntry => ({
  indicator: IndicatorId.make(indicator),
  name,
  definition,
})

export const worldBankList = [
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

const eurostatList = [
  entry("ESTAT,UNE_RT_A,1.0", "Unemployment by sex and age - annual data"),
  entry("ESTAT,TPS00001,1.0", "Population on 1 January"),
]

const oecdList = [
  entry(
    "OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0",
    "Monthly unemployment rates",
    "The monthly unemployment rate is a subset of the infra-annual labour statistics.",
  ),
]

// What each source lists, or "down" when it fails. Tests change it between
// builds.
export type Listings = Record<Source, ReadonlyArray<CatalogEntry> | "down">

export const listings = (changes: Partial<Listings> = {}): Listings => ({
  "World Bank": worldBankList,
  Eurostat: eurostatList,
  OECD: oecdList,
  ...changes,
})

const list = (lists: Listings, source: Source) =>
  Effect.suspend(() => {
    const listed = lists[source]

    return listed === "down"
      ? Effect.fail(new SourceUnavailable({ source }))
      : Effect.succeed(listed)
  })

// The World Bank and the SDMX sources, answering only their indicator lists.
const sources = (lists: Listings) =>
  Layer.mergeAll(
    Layer.succeed(
      WorldBank,
      WorldBank.of({
        describe: () => Effect.die("not used by the catalog"),
        observations: () => Effect.die("not used by the catalog"),
        indicators: list(lists, "World Bank"),
        version: Effect.die("not used by the catalog"),
        series: () => Effect.die("not used by the catalog"),
      }),
    ),
    Layer.succeed(
      Sdmx,
      Sdmx.of({
        describe: () => Effect.die("not used by the catalog"),
        observations: () => Effect.die("not used by the catalog"),
        indicators: (source) => list(lists, source),
      }),
    ),
  )

// Workers AI as a dictionary: a text's vector marks the topics it mentions,
// so "how rich" lands next to "GDP per capita" and unrelated text next to
// nothing.
const topics = [/\brich\b|per capita|income/i, /\bkids\b|under-five/i]

export const workersAi = (answers: { up: boolean }): Ai => ({
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

// A Vectorize index in memory, recording how many vectors each upsert stored
// and the ids each delete named.
export const vectorize = () => {
  const stored = new Map<string, ReadonlyArray<number>>()
  const upserts: Array<number> = []
  const deletes: Array<ReadonlyArray<string>> = []

  const index: Index = {
    upsert: (vectors) => {
      upserts.push(vectors.length)

      for (const { id, values } of vectors) stored.set(id, values)

      return Promise.resolve({ mutationId: String(upserts.length) })
    },
    deleteByIds: (ids) => {
      deletes.push(ids)

      for (const id of ids) stored.delete(id)

      return Promise.resolve({ mutationId: `delete ${deletes.length}` })
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

  return { index, upserts: () => upserts, deletes: () => deletes }
}

const db = env.DB

if (db === undefined) throw new Error("vitest.config.ts must bind a D1 database as DB")

// The test Worker's D1 database is shared by every test that uses it.
export const emptyCatalog = () =>
  db.exec(
    "DROP TABLE IF EXISTS catalog; DROP TABLE IF EXISTS catalog_current; DROP TABLE IF EXISTS catalog_fingerprint; DROP TABLE IF EXISTS catalog_vector; DROP TABLE IF EXISTS catalog_direction;",
  )

// Drops tables, leaving the catalog as an earlier version made it.
export const drop = (...tables: ReadonlyArray<string>) =>
  Effect.promise(() => db.exec(tables.map((table) => `DROP TABLE ${table};`).join(" ")))

// The published generation of each source.
export const published = () =>
  Effect.promise(() =>
    db.prepare("SELECT source, generation FROM catalog_current ORDER BY source").all(),
  ).pipe(Effect.map(({ results }) => results))

// The real catalog and its build over the test Worker's local D1 database,
// with the sources faked as services, Workers AI and Vectorize faked at
// their bindings, and no classifier unless a test passes one (test/model.ts).
// Each layer built is a Worker starting: it creates the tables it lacks.
export const catalogOver = (
  lists: Listings,
  {
    ai = workersAi({ up: true }),
    index = vectorize().index,
    model,
    classifier = Classifier.unavailable,
  }: {
    ai?: Ai
    index?: Index
    model?: string
    classifier?: Layer.Layer<Classifier>
  } = {},
) =>
  Layer.mergeAll(Catalog.layer, CatalogBuild.layer).pipe(
    Layer.provide(sources(lists)),
    Layer.provide(Vectors.cloudflare({ ai, index, model })),
    Layer.provide(classifier),
    Layer.provide(D1Client.layer({ db }).pipe(Layer.orDie)),
  )

// The directions charts read: the hand-checked list, then what builds stored
// in the test Worker's D1 database.
export const stored = Directions.layer.pipe(Layer.provide(D1Client.layer({ db }).pipe(Layer.orDie)))

export const build = (generation: number) =>
  CatalogBuild.run(generation).pipe(Effect.provide(Step.immediate))
