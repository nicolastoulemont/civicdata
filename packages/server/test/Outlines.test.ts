import {
  type CatalogEntry,
  IndicatorId,
  Source,
  SourceUnavailable,
  Code,
  Country,
  DimensionId,
} from "@civicdata/domain"
import { beforeEach, describe, expect, it } from "@effect/vitest"
import { reset } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { Effect, Schema, Stream } from "effect"

import { type Adapter, type Discovery, Policy } from "../src/Adapter.ts"
import { Catalog } from "../src/Catalog.ts"
import { CatalogBuild } from "../src/CatalogBuild.ts"
import { Outline } from "../src/Outlines.ts"
import { constraints, Constraints, DataStructures } from "../src/Outlines.ts"
import { fill } from "../src/Structures.ts"
import {
  build,
  catalogOver,
  entry,
  listings,
  recordings,
  unstructured,
  vectorize,
} from "./catalog.ts"
import oecdConstraints from "./fixtures/structures/oecd-constraints.json"
import oecdStructures from "./fixtures/structures/oecd-structures.json"

// Every test starts from empty bindings: the test Worker's D1 database is
// shared by the file's tests.
beforeEach(() => reset())

const names = (entries: ReadonlyArray<CatalogEntry>) => entries.map((found) => found.name)

const unemployment = IndicatorId.make("ESTAT,UNE_RT_A,1.0")
const monthly = IndicatorId.make("OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0")

// What each source lists, with the datasets no chart can show: monthly-only
// values, or none of our countries.
const withHidden = listings({
  Eurostat: [
    entry("ESTAT,UNE_RT_A,1.0", "Unemployment by sex and age - annual data"),
    entry("ESTAT,TPS00001,1.0", "Population on 1 January"),
    entry("ESTAT,TEIMF060,1.0", "Euro yield curve by maturity (1, 5 and 10 years)"),
    entry(
      "ESTAT,LFST_DPW_05,1.0",
      "Distribution of digital platform workers (at least one hour in the last month) by labour status",
    ),
  ],
  OECD: [
    entry("OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0", "Monthly unemployment rates"),
    entry("OECD.SWAC,DSD_SWAC_PV@DF_PV_REGION,1.0", "Political violence by region"),
    entry("OECD.ENV.EEI,DSD_GHG_PLC@DF_GHG_PLC,1.0", "Greenhouse gas emissions from plastics"),
  ],
})

const db = env.CATALOG_DB

if (db === undefined) throw new Error("vitest.config.ts must bind a D1 database as CATALOG_DB")

// Every stored outline and label, as a build left them.
const stored = Effect.promise(() =>
  db.batch([
    db.prepare("SELECT * FROM catalog_outline ORDER BY indicator"),
    db.prepare("SELECT * FROM catalog_label ORDER BY source, codelist, code"),
  ]),
).pipe(Effect.map((results) => results.map(({ results: rows }) => rows)))

describe("Outlines", () => {
  it.effect("stores each dataset's dimensions with labelled codes, countries and years", () =>
    Effect.gen(function* () {
      yield* build(1)

      const outlines = yield* (yield* Catalog).outlines([unemployment, monthly])
      const eurostat = outlines.get(unemployment)
      const oecd = outlines.get(monthly)

      expect(eurostat?.annual).toBe(true)
      expect(eurostat?.years).toEqual({ first: 2003, last: 2025 })
      expect(eurostat?.countries).toContain("FRA")
      expect(eurostat?.dimensions.map(({ id }) => id)).toEqual(["age", "sex", "unit"])
      expect(eurostat?.dimensions[1]?.codes).toEqual([
        { code: "T", label: "Total" },
        { code: "M", label: "Males" },
        { code: "F", label: "Females" },
      ])

      expect(oecd?.annual).toBe(true)
      expect(oecd?.years).toEqual({ first: 1953, last: 2026 })
      expect(oecd?.countries).toContain("CAN")
      expect(oecd?.dimensions.find(({ id }) => id === "AGE")?.codes).toEqual([
        { code: "Y_GE15", label: "15 years or over" },
        { code: "Y_GE25", label: "25 years or over" },
        { code: "Y15T24", label: "From 15 to 24 years" },
      ])
    }).pipe(Effect.provide(catalogOver(listings()))),
  )

  it.effect("writes nothing and asks for no codelist when nothing changed", () => {
    const recorded = recordings()

    return Effect.gen(function* () {
      const catalog = yield* CatalogBuild

      yield* build(1)

      const before = yield* stored
      const asked = recorded.asked().length

      expect(yield* catalog.outline("Eurostat")).toBe(0)
      expect(yield* catalog.outline("OECD")).toBe(0)
      expect(yield* catalog.label("Eurostat", "")).toBeNull()
      expect(yield* catalog.label("OECD", "")).toBeNull()
      expect(yield* catalog.describe("Eurostat")).toBe(0)
      expect(yield* catalog.describe("OECD")).toBe(0)
      expect(yield* stored).toEqual(before)
      // The metabase, and the OECD's constraints and structures: no
      // codelist.
      expect(recorded.asked().slice(asked)).toEqual([
        "https://ec.europa.eu/eurostat/api/dissemination/catalogue/metabase.txt.gz",
        "https://sdmx.oecd.org/public/rest/contentconstraint/all/all/latest",
        "https://sdmx.oecd.org/public/rest/datastructure/all/all/latest?detail=full&references=none",
      ])
    }).pipe(Effect.provide(catalogOver(listings(), { structures: recorded.layer })))
  })

  it.effect("leaves datasets with no annual values or none of our countries out of search", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog

      yield* build(1)

      expect(yield* catalog.search("yield curve")).toEqual([])
      expect(yield* catalog.search("digital platform")).toEqual([])
      expect(yield* catalog.search("political violence")).toEqual([])
      expect(yield* catalog.search("plastics")).toEqual([])
      expect(names(yield* catalog.search("unemployment")).toSorted()).toEqual([
        "Monthly unemployment rates",
        "Unemployment by sex and age - annual data",
        "Unemployment, total (% of total labor force)",
        "Unemployment, youth total (% of total labor force ages 15-24)",
      ])
    }).pipe(Effect.provide(catalogOver(withHidden))),
  )

  it.effect("finds a dataset by the label of one of its codes", () =>
    Effect.gen(function* () {
      yield* build(1)

      // Neither name says "women": their sex dimensions have Females.
      expect(names(yield* (yield* Catalog).search("women")).toSorted()).toEqual([
        "Monthly unemployment rates",
        "Unemployment by sex and age - annual data",
      ])
    }).pipe(Effect.provide(catalogOver(listings()))),
  )

  it.effect("embeds a dataset again once its labels change", () => {
    const { index, upserts } = vectorize()

    return Effect.gen(function* () {
      yield* build(1)

      const embedded = upserts().length

      yield* Effect.promise(() =>
        db
          .prepare(
            "UPDATE catalog_label SET label = 'Women' WHERE codelist = 'ESTAT:SEX' AND code = 'F'",
          )
          .run(),
      )
      yield* build(2)

      // The two Eurostat datasets with a sex dimension: only unemployment.
      expect(upserts().slice(embedded)).toEqual([1])
    }).pipe(Effect.provide(catalogOver(listings(), { index })))
  })

  it.effect("keeps the stored outlines when the sources publish none", () =>
    Effect.gen(function* () {
      yield* build(1)

      const before = yield* stored

      yield* build(2).pipe(
        Effect.provide(catalogOver(listings(), { structures: unstructured }), { local: true }),
        Effect.flip,
      )

      expect(yield* stored).toEqual(before)
      expect(names(yield* (yield* Catalog).search("unemployment by sex"))).toEqual([
        "Unemployment by sex and age - annual data",
      ])
    }).pipe(Effect.provide(catalogOver(listings()))),
  )

  it.effect("fills a stage from the bulk files, labelling every code in one request", () => {
    const recorded = recordings()

    return Effect.gen(function* () {
      expect(yield* fill("Eurostat")).toEqual({ outlines: 4, labels: 14, texts: 3 })
      expect(yield* fill("OECD")).toEqual({ outlines: 3, labels: 12, texts: 1 })
      expect(recorded.asked().filter((url) => url.includes("codelist"))).toEqual([
        "https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/codelist/ESTAT/all/latest?format=JSON&lang=en",
        "https://sdmx.oecd.org/public/rest/codelist/all/all/latest",
      ])

      // A build after the fill asks for no codelist either.
      const asked = recorded.asked().length

      yield* build(1)

      expect(
        recorded
          .asked()
          .slice(asked)
          .filter((url) => url.includes("codelist")),
      ).toEqual([])
      expect(names(yield* (yield* Catalog).search("women")).toSorted()).toEqual([
        "Monthly unemployment rates",
        "Unemployment by sex and age - annual data",
      ])
    }).pipe(Effect.provide(catalogOver(listings(), { structures: recorded.layer })))
  })
})

it.effect("combines repeated Actual constraints into one stable dataset outline", () =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(Constraints)(oecdConstraints)
    const structures = yield* Schema.decodeUnknownEffect(DataStructures)(oecdStructures)

    const original = constraints({ constraints: decoded, structures })

    const repeated = constraints({
      constraints: {
        data: {
          contentConstraints: [
            ...decoded.data.contentConstraints,
            ...decoded.data.contentConstraints,
          ],
        },
      },
      structures,
    })

    expect(repeated).toEqual(original)
  }),
)

describe("registered publisher discovery", () => {
  const source = Source.make("Example Files")
  const indicator = IndicatorId.make("Example Files:income")

  const outline = (changes: Partial<Outline> = {}): Outline => ({
    indicator,
    dimensions: [
      {
        id: DimensionId.make("measure"),
        codelist: null,
        codes: [Code.make("median"), Code.make("constructor"), Code.make("toString")],
        labels: { [Code.make("median")]: "Median disposable income" },
      },
    ],
    annual: true,
    countries: [Country.make("FRA")],
    years: { first: 2000, last: 2025 },
    ...changes,
  })

  const adapter = (outlines: Discovery): Adapter => ({
    policy: Policy.None(),
    discovery: outlines,
    list: Effect.succeed([
      entry(indicator, "Household income"),
      entry("Example Files:monthly", "Monthly income"),
      entry("Example Files:outside", "Outside income"),
      entry("Example Files:unknown", "Unknown income"),
    ]),
    describe: () => Effect.die("unused"),
    fetch: () => Effect.die("unused"),
  })

  it.effect("publishes file labels and known or unknown coverage through the normal build", () => {
    const { index, upserts } = vectorize()

    const discovery = {
      outlines: Stream.fromIterable([
        outline(),
        outline({ indicator: IndicatorId.make("Example Files:monthly"), annual: false }),
        outline({ indicator: IndicatorId.make("Example Files:outside"), countries: [] }),
        outline({
          indicator: IndicatorId.make("Example Files:unknown"),
          annual: null,
          countries: null,
          years: null,
        }),
      ]),
    }

    return Effect.gen(function* () {
      yield* build(1)
      const catalog = yield* Catalog
      expect(names(yield* catalog.search("income", { source })).toSorted()).toEqual([
        "Household income",
        "Unknown income",
      ])
      const found = yield* catalog.outlines([indicator, IndicatorId.make("Example Files:unknown")])
      expect(found.get(indicator)?.dimensions[0]?.codes).toEqual([
        { code: "median", label: "Median disposable income" },
        { code: "constructor", label: "constructor" },
        { code: "toString", label: "toString" },
      ])
      expect((yield* stored)[0]).toContainEqual(
        expect.objectContaining({ indicator, text: "Median disposable income" }),
      )
      expect(found.get(indicator)?.countries).toEqual(["FRA"])
      expect(found.get(indicator)?.years).toEqual({ first: 2000, last: 2025 })
      expect(found.get(IndicatorId.make("Example Files:unknown"))).toMatchObject({
        annual: null,
        countries: null,
        years: null,
      })
      const embedded = upserts().length
      yield* build(2)
      expect(upserts()).toHaveLength(embedded)

      const changed = {
        outlines: Stream.concat(
          discovery.outlines.pipe(Stream.drop(1)),
          Stream.succeed(
            outline({
              dimensions: [
                {
                  id: DimensionId.make("measure"),
                  codelist: null,
                  codes: [Code.make("median")],
                  labels: { [Code.make("median")]: "Revised median income" },
                },
              ],
            }),
          ),
        ),
      }

      yield* build(3).pipe(
        Effect.provide(
          catalogOver(listings(), { index, adapters: { [source]: adapter(changed) } }),
          { local: true },
        ),
      )
      expect(upserts().slice(embedded)).toEqual([1])
    }).pipe(
      Effect.provide(
        catalogOver(listings(), { index, adapters: { [source]: adapter(discovery) } }),
      ),
    )
  })

  it.effect("retains the published catalog when discovery fails and other sources advance", () => {
    const state = { up: true }

    const discovery = {
      outlines: Stream.unwrap(
        Effect.suspend(() =>
          state.up
            ? Effect.succeed(Stream.succeed(outline()))
            : Effect.succeed(
                Stream.concat(
                  Stream.fromIterable(
                    Array.from({ length: 101 }, (_, at) =>
                      outline({
                        indicator:
                          at === 0 ? indicator : IndicatorId.make(`Example Files:partial${at}`),
                        countries: [],
                        dimensions: [],
                      }),
                    ),
                  ),
                  Stream.fail(new SourceUnavailable({ source })),
                ),
              ),
        ),
      ),
    }

    const lists = listings()

    return Effect.gen(function* () {
      yield* build(1)
      const before = yield* stored
      state.up = false
      lists["World Bank"] = [entry("NEW.1", "Newly listed")]
      expect(yield* build(2).pipe(Effect.flip)).toMatchObject({ sources: [source] })
      expect(yield* stored).toEqual(before)
      expect(names(yield* (yield* Catalog).search("income", { source }))).toEqual([
        "Household income",
        "Monthly income",
        "Outside income",
        "Unknown income",
      ])
      expect(names(yield* (yield* Catalog).search("newly listed"))).toEqual(["Newly listed"])
    }).pipe(Effect.provide(catalogOver(lists, { adapters: { [source]: adapter(discovery) } })))
  })
})
