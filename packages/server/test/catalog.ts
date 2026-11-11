import { type CatalogEntry, IndicatorId, type Source, SourceUnavailable } from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import { gzipSync, strToU8 } from "fflate"

import { type Adapter, Policy } from "../src/Adapter.ts"
import { Catalog } from "../src/Catalog.ts"
import { CatalogBuild, Step } from "../src/CatalogBuild.ts"
import { Classifier } from "../src/Classifier.ts"
import { Directions } from "../src/Directions.ts"
import { Outlines } from "../src/Outlines.ts"
import { eurostat, oecd } from "../src/Sdmx.ts"
import { Sources } from "../src/Sources.ts"
import { discovery, Structures } from "../src/Structures.ts"
import { type Ai, type Index, Vectors } from "../src/Vectors.ts"
import { http } from "./fakes.ts"
import eurostatCodelists from "./fixtures/structures/eurostat-codelists.json?raw"
import metabase from "./fixtures/structures/metabase.txt?raw"
import oecdCodelists from "./fixtures/structures/oecd-codelists.json?raw"
import oecdConstraints from "./fixtures/structures/oecd-constraints.json?raw"
import oecdStructures from "./fixtures/structures/oecd-structures.json?raw"

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
export type Listings = Record<Source, ReadonlyArray<CatalogEntry> | "down"> & {
  "World Bank": ReadonlyArray<CatalogEntry> | "down"
  Eurostat: ReadonlyArray<CatalogEntry> | "down"
  OECD: ReadonlyArray<CatalogEntry> | "down"
}

export const listings = (changes: Partial<Listings> = {}): Listings => ({
  "World Bank": worldBankList,
  Eurostat: eurostatList,
  OECD: oecdList,
  ...changes,
})

const list = (lists: Listings, source: Source) =>
  Effect.suspend(() => {
    const listed = lists[source] ?? []

    return listed === "down"
      ? Effect.fail(new SourceUnavailable({ source }))
      : Effect.succeed(listed)
  })

// A source answering only its catalog entries.
const listing = (lists: Listings, source: Source): Adapter => ({
  policy: Policy.Api(),
  list: list(lists, source),
  describe: () => Effect.die("not used by the catalog"),
  fetch: () => Effect.die("not used by the catalog"),
})

// Every source, answering only its catalog entries.
const sources = (lists: Listings, extra: Readonly<Record<Source, Adapter>>) =>
  Layer.effect(
    Sources,
    Effect.gen(function* () {
      const structures = yield* Structures

      return Sources.of({
        ...Object.fromEntries(Object.keys(lists).map((source) => [source, listing(lists, source)])),
        "World Bank": listing(lists, "World Bank"),
        Eurostat: { ...listing(lists, "Eurostat"), discovery: discovery(structures, "Eurostat") },
        OECD: { ...listing(lists, "OECD"), discovery: discovery(structures, "OECD") },
        ...extra,
      })
    }),
  )

// Workers AI as a dictionary: a text's vector marks the topics it mentions,
// so "how rich" lands next to "GDP per capita", "women" next to a dataset
// with a "Females" code, and unrelated text next to nothing.
const topics = [/\brich\b|per capita|income/i, /\bkids\b|under-five/i, /\bwomen\b|\bfemales?\b/i]

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

// What Eurostat and the OECD published about their datasets' structure on
// 2026-11-11, trimmed to a few datasets: Eurostat's unemployment and
// population, a monthly-only yield curve (TEIMF060) and a survey of the EU
// as a whole (LFST_DPW_05); the OECD's monthly unemployment rates, a
// monthly-only count of political violence (DF_PV_REGION) and plastics
// emissions with no country (DF_GHG_PLC). Each codelist lists only the codes
// these use. `asked` records every URL.
export const recordings = () => {
  const asked: Array<string> = []

  const eurostatItems: ReadonlyArray<{ readonly extension: { readonly id: string } }> =
    JSON.parse(eurostatCodelists).link.item

  const oecdLists: ReadonlyArray<{ readonly agencyID: string; readonly id: string }> =
    JSON.parse(oecdCodelists).data.codelists

  const answers = new Map<string, () => Response>([
    [`${eurostat}/catalogue/metabase.txt.gz`, () => new Response(gzipSync(strToU8(metabase)))],
    [
      `${eurostat}/sdmx/2.1/codelist/ESTAT/all/latest?format=JSON&lang=en`,
      () => new Response(eurostatCodelists),
    ],
    ...eurostatItems.map(
      (item) =>
        [
          `${eurostat}/sdmx/2.1/codelist/ESTAT/${item.extension.id}/latest?format=JSON&lang=en`,
          () => Response.json(item),
        ] as const,
    ),
    [`${oecd}/contentconstraint/all/all/latest`, () => new Response(oecdConstraints)],
    [
      `${oecd}/datastructure/all/all/latest?detail=full&references=none`,
      () => new Response(oecdStructures),
    ],
    [`${oecd}/codelist/all/all/latest`, () => new Response(oecdCodelists)],
    ...oecdLists.map(
      (codelist) =>
        [
          `${oecd}/codelist/${codelist.agencyID}/${codelist.id}/latest`,
          () => Response.json({ data: { codelists: [codelist] } }),
        ] as const,
    ),
  ])

  const layer = Structures.layer.pipe(
    Layer.provide(
      http((url) => {
        asked.push(url)

        return answers.get(url)?.() ?? new Response("no recording", { status: 404 })
      }),
    ),
  )

  return { layer, asked: () => asked }
}

// Sources that publish nothing about their datasets' structure.
export const unstructured = Structures.layer.pipe(
  Layer.provide(http(() => new Response("down", { status: 503 }))),
)

const db = env.CATALOG_DB

if (db === undefined) throw new Error("vitest.config.ts must bind a D1 database as CATALOG_DB")

// Drops tables, leaving the catalog as an earlier version made it.
export const drop = (...tables: ReadonlyArray<string>) =>
  Effect.promise(() => db.exec(tables.map((table) => `DROP TABLE ${table};`).join(" ")))

// Runs SQL statements on the test Worker's D1 database, one per line.
export const exec = (statements: string) => Effect.promise(() => db.exec(statements))

// Each direction builds stored, with the model that gave it.
export const classified = Effect.promise(() =>
  db.prepare("SELECT indicator, direction, model FROM catalog_direction ORDER BY indicator").all(),
).pipe(Effect.map(({ results }) => results))

// The published generation of each source.
export const published = () =>
  Effect.promise(() =>
    db.prepare("SELECT source, generation FROM catalog_current ORDER BY source").all(),
  ).pipe(Effect.map(({ results }) => results))

// The real catalog and its build over the test Worker's local D1 database,
// with the sources faked as services, Workers AI and Vectorize faked at
// their bindings, and classification off unless a test passes a classifier (test/decisions.ts).
// Only a build creates tables, as it does in a deployed Workflow.
export const catalogOver = (
  lists: Listings,
  {
    ai = workersAi({ up: true }),
    index = vectorize().index,
    model,
    classifier = Classifier.off,
    structures = recordings().layer,
    adapters = {},
  }: {
    ai?: Ai
    index?: Index
    model?: string
    classifier?: Layer.Layer<Classifier>
    structures?: Layer.Layer<Structures>
    adapters?: Readonly<Record<Source, Adapter>>
  } = {},
) =>
  Layer.mergeAll(Catalog.layer, CatalogBuild.layer).pipe(
    Layer.provideMerge(Outlines.layer),
    Layer.provide(sources(lists, adapters)),
    Layer.provideMerge(structures),
    Layer.provide(Vectors.cloudflare({ ai, index, model })),
    Layer.provide(classifier),
    Layer.provide(D1Client.layer({ db }).pipe(Layer.orDie)),
  )

// The directions charts read: the hand-checked list, then what builds stored
// in the test Worker's D1 database.
export const stored = Directions.layer.pipe(Layer.provide(D1Client.layer({ db }).pipe(Layer.orDie)))

export const build = (generation: number) =>
  CatalogBuild.run({ id: `build ${generation}`, generation }).pipe(Effect.provide(Step.immediate))
