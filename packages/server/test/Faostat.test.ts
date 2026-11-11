import { D1Client } from "@effect/sql-d1"
import { beforeEach, expect, it } from "@effect/vitest"
import { Code, DimensionId, Trend, Year, SourceUnavailable, Qualification } from "@openfacts/domain"
import { reset } from "cloudflare:test"
import { DateTime, Effect, Layer, Schema, Stream } from "effect"
import { SqlClient } from "effect/sql"

import toc from "../../../docs/research/faostat/manifest.json?raw"
import raw from "../../../docs/research/faostat/record.json" with { type: "json" }
import { tables } from "../src/Catalog.ts"
import { Step } from "../src/CatalogBuild.ts"
import { Directions } from "../src/Directions.ts"
import { asti, Faostat, FaostatArchive } from "../src/Faostat.ts"
import { Gather } from "../src/Gather.ts"
import { Ilostat } from "../src/Ilostat.ts"
import { Imf } from "../src/Imf.ts"
import { Insee } from "../src/Insee.ts"
import { Resolver } from "../src/Resolver.ts"
import { Sdmx } from "../src/Sdmx.ts"
import { Sources } from "../src/Sources.ts"
import { Store } from "../src/Store.ts"
import { summarize } from "../src/Summary.ts"
import { Vdem } from "../src/Vdem.ts"
import { Who } from "../src/Who.ts"
import { Wid } from "../src/Wid.ts"
import { WorldBank } from "../src/WorldBank.ts"
import { http } from "./fakes.ts"
import { seriesDb, bucket } from "./series.ts"

const { indicator, manifestUrl, record } = asti

beforeEach(() => reset())

it.effect("registers FAOSTAT in the real all-publisher registry", () =>
  Effect.gen(function* () {
    const registered = yield* Sources.pipe(
      Effect.provide(
        Sources.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Vdem.layer,
              Wid.layer,
              Imf.layer,
              Who.layer,
              WorldBank.layer,
              Sdmx.layer,
              Insee.layer,
              Ilostat.layer,
              Faostat.layer,
            ),
          ),
          Layer.provide(http(() => new Response(toc))),
        ),
      ),
    )

    expect(Object.keys(registered)).toContain("FAOSTAT")
    const source = yield* Sources.get(registered, indicator)
    expect((yield* source.describe(indicator)).indicator.id).toBe(indicator)
    expect((yield* source.list).map((item) => item.indicator)).toEqual([indicator])
  }),
)

it.effect(
  "discovers only the reviewed annual table and keeps a stored miss off observation endpoints",
  () =>
    Effect.gen(function* () {
      const requests: Array<string> = []

      const source = yield* Faostat.pipe(
        Effect.provide(
          Faostat.layer.pipe(
            Layer.provide(
              http((url) => {
                requests.push(url)

                return new Response(toc)
              }),
            ),
          ),
        ),
      )

      expect((yield* source.list).map((entry) => entry.indicator)).toEqual([indicator])
      const outlines = yield* Stream.runCollect(source.discovery?.outlines ?? Stream.empty)
      expect(outlines[0]?.dimensions.map((dimension) => dimension.id)).toEqual([
        "measure",
        "cost",
        "institution",
      ])
      expect(outlines[0]?.countries).toBeNull()

      const registered = Sources.of({
        "World Bank": source,
        Eurostat: source,
        OECD: source,
        FAOSTAT: source,
      })

      const reads = yield* Sources.pipe(
        Effect.provide(Sources.stored),
        Effect.provideService(Sources, registered),
        Effect.provide(Store.r2(bucket().bucket)),
      )

      const result = yield* (
        reads["FAOSTAT"]
          ?.fetch({
            indicator,
            dimensions: {},
            countries: ["ARG"],
            from: Year.make(2020),
            to: Year.make(2025),
          })
          .pipe(Effect.result) ?? Effect.die("missing adapter")
      )

      expect(result).toMatchObject({
        failure: {
          open: ["measure", "cost", "institution"],
          dimensions: [{ id: "measure" }, { id: "cost" }, { id: "institution" }],
        },
      })
      const adapter = yield* Sources.get(reads, indicator)

      const absent = yield* adapter
        .fetch({
          indicator,
          dimensions: {
            [DimensionId.make("measure")]: Code.make("8006"),
            [DimensionId.make("cost")]: Code.make("300"),
            [DimensionId.make("institution")]: Code.make("200"),
          },
          countries: ["ARG"],
          from: Year.make(2020),
          to: Year.make(2025),
        })
        .pipe(Effect.result)

      expect(absent).toMatchObject({ failure: { reason: "NotStored" } })
      expect(requests).toEqual([manifestUrl, manifestUrl])
    }),
)

it.effect("preserves missing values, raw flags and notes without an ILO survey", () =>
  Effect.gen(function* () {
    const parsed = yield* record({ ...raw, Value: "", Flag: "Z", Note: "Publisher caveat" })
    expect(parsed?.observations).toEqual([])
    expect(parsed?.qualifications[0]).toMatchObject({
      source: "FAOSTAT",
      missing: true,
      status: { code: "Z", label: "Unrecognized publisher flag" },
      notes: [{ label: "Publisher caveat" }],
    })
    expect(yield* record({ ...raw, Unit: "million USD" }).pipe(Effect.result)).toMatchObject({
      failure: { source: "FAOSTAT" },
    })
    expect(yield* record({ ...raw, Year: "2010Q1", "Year Code": "2010Q1" })).toBeUndefined()
    expect(
      yield* record({ ...raw, "Area Code": "5400", "Area Code (M49)": "'150", Area: "Europe" }),
    ).toBeUndefined()
    expect(
      yield* record({
        ...raw,
        "Area Code": "41",
        "Area Code (M49)": "'156",
        Area: "China, mainland",
      }),
    ).toBeUndefined()
    expect(yield* record({ ...raw, "Area Code (M49)": "'999" }).pipe(Effect.result)).toMatchObject({
      failure: { source: "FAOSTAT" },
    })
  }),
)

it.effect(
  "gathers the selected asset once and serves its missing evidence without archive requests",
  () =>
    Effect.gen(function* () {
      const parsed = yield* record({ ...raw, Value: "", Flag: "I", Note: "Publisher caveat" })

      if (parsed === undefined) return yield* Effect.die("missing row")

      let downloads = 0
      let manifest = toc
      let note = "Publisher caveat"

      const disk = Layer.succeed(
        FaostatArchive,
        FaostatArchive.of({
          read: (version) => {
            downloads += 1

            if (downloads === 1) return Stream.fail(new SourceUnavailable({ source: "FAOSTAT" }))

            return Stream.make({
              ...parsed,
              qualifications: parsed.qualifications.map((item) =>
                Schema.decodeUnknownSync(Qualification)({
                  ...item,
                  notes: [{ category: "Note", code: "Note", label: note }],
                }),
              ),
              indicator: {
                id: indicator,
                name: "Agricultural research spending",
                definition: "Percent of agricultural value added",
              },
              dataset: "FAOSTAT",
              version,
              retrievedAt: DateTime.makeUnsafe("2026-11-11T12:00:00Z"),
            })
          },
        }),
      )

      const source = yield* Faostat.pipe(
        Effect.provide(
          Faostat.layer.pipe(
            Layer.provide(disk),
            Layer.provide(http(() => new Response(manifest))),
          ),
        ),
      )

      const registered = Sources.of({
        "World Bank": source,
        Eurostat: source,
        OECD: source,
        FAOSTAT: source,
      })

      const store = bucket()
      yield* Effect.gen(function* () {
        yield* tables
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO catalog_current (source, generation) VALUES ('FAOSTAT', 1)`
        yield* sql`INSERT INTO catalog (source, generation, indicator, name, definition) VALUES ('FAOSTAT', 1, ${indicator}, 'Research spending', 'Percent')`
        yield* Gather.run("FAOSTAT")
          .pipe(Effect.provide(Layer.merge(Gather.layer, Step.immediate)))
          .pipe(Effect.result)
        yield* Gather.run("FAOSTAT").pipe(Effect.provide(Layer.merge(Gather.layer, Step.immediate)))
        yield* Gather.run("FAOSTAT").pipe(Effect.provide(Layer.merge(Gather.layer, Step.immediate)))
        const sources = yield* Sources.pipe(Effect.provide(Sources.stored))
        const adapter = yield* Sources.get(sources, indicator)

        const answer = yield* adapter.fetch({
          indicator,
          dimensions: parsed.dimensions,
          countries: ["ARG"],
          from: Year.make(2010),
          to: Year.make(2010),
        })

        expect(answer.observations).toEqual([])
        expect(answer.qualifications).toEqual(parsed.qualifications)

        const resolver = yield* Resolver.pipe(
          Effect.provide(Resolver.layer),
          Effect.provideService(Sources, sources),
          Effect.provide(Directions.listed),
        )

        const view = Trend.make({
          indicator,
          dimensions: parsed.dimensions,
          countries: ["ARG"],
          from: Year.make(2010),
          to: Year.make(2010),
        })

        const resolved = yield* resolver.resolve(view)
        expect(resolved.qualifications).toEqual(parsed.qualifications)
        expect(summarize(resolved).qualifications).toEqual(parsed.qualifications)
        expect(resolved.sources[0].dataset).toContain("FAO")
        expect(resolved.sources[0].url).toContain("ASTI_Expenditures")

        const rejected = yield* resolver
          .resolve({ ...view, transform: "Growth" })
          .pipe(Effect.result)

        expect(rejected).toMatchObject({ failure: { indicator, transform: "Growth" } })
        expect(downloads).toBe(2)
        manifest = toc.replaceAll("2026-04-30", "2026-05-01")
        note = "Revised publisher caveat"
        yield* Gather.run("FAOSTAT").pipe(Effect.provide(Layer.merge(Gather.layer, Step.immediate)))

        const revised = yield* adapter.fetch({
          indicator,
          dimensions: parsed.dimensions,
          countries: ["ARG"],
          from: Year.make(2010),
          to: Year.make(2010),
        })

        expect(revised.qualifications?.[0]?.notes[0]?.label).toBe(note)
        expect(downloads).toBe(3)
      }).pipe(
        Effect.provideService(Sources, registered),
        Effect.provide(
          Layer.merge(Store.r2(store.bucket), D1Client.layer({ db: seriesDb }).pipe(Layer.orDie)),
        ),
      )

      return undefined
    }),
)
