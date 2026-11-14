import { D1Client } from "@effect/sql-d1"
import { beforeEach, expect, it } from "@effect/vitest"
import { Code, DimensionId, Trend, Year } from "@repo/domain"
import { reset } from "cloudflare:test"
import { DateTime, Effect, Layer, Stream } from "effect"
import { SqlClient } from "effect/sql"

import toc from "../../../../../docs/research/ilostat/toc.csv?raw"
import { tables } from "../../catalog/Catalog.ts"
import { Directions } from "../../catalog/Directions.ts"
import { Gather } from "../../gather/Gather.ts"
import { Step } from "../../platform/Step.ts"
import { Store } from "../../series/Store.ts"
import { http } from "../../tests/fakes.ts"
import { Resolver } from "../../views/Resolver.ts"
import { summarize } from "../../views/utils/summarize.ts"
import { indicator } from "../constants/ilostat/indicator.ts"
import { tocUrl } from "../constants/ilostat/tocUrl.ts"
import { Ilostat, IlostatArchive, record } from "../Ilostat.ts"
import { Sources } from "../Sources.ts"
import { seriesDb, bucket } from "./series.ts"

beforeEach(() => reset())

it.effect(
  "discovers only the reviewed annual table and keeps a stored miss off observation endpoints",
  () =>
    Effect.gen(function* () {
      const requests: Array<string> = []

      const source = yield* Ilostat.pipe(
        Effect.provide(
          Ilostat.layer.pipe(
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
      expect(outlines[0]?.dimensions.map((dimension) => dimension.id)).toEqual(["source"])
      expect(outlines[0]?.countries).not.toContain("X01")

      const registered = Sources.of({
        "World Bank": source,
        Eurostat: source,
        OECD: source,
        ILOSTAT: source,
      })

      const reads = yield* Sources.pipe(
        Effect.provide(Sources.stored),
        Effect.provideService(Sources, registered),
        Effect.provide(Store.r2(bucket().bucket)),
      )

      const result = yield* (
        reads["ILOSTAT"]
          ?.fetch({
            indicator,
            dimensions: {},
            countries: ["AFG"],
            from: Year.make(2020),
            to: Year.make(2025),
          })
          .pipe(Effect.result) ?? Effect.die("missing adapter")
      )

      expect(result).toMatchObject({
        failure: { open: ["source"], dimensions: [{ id: "source" }] },
      })
      const adapter = yield* Sources.get(reads, indicator)

      const absent = yield* adapter
        .fetch({
          indicator,
          dimensions: { [DimensionId.make("source")]: Code.make("s42413a3135373135") },
          countries: ["AFG"],
          from: Year.make(2020),
          to: Year.make(2025),
        })
        .pipe(Effect.result)

      expect(absent).toMatchObject({ failure: { reason: "NotStored" } })
      expect(requests).toEqual([tocUrl, tocUrl])
    }),
)

it.effect("rejects malformed publisher evidence instead of inventing an observation", () =>
  Effect.gen(function* () {
    const parsed = yield* record({
      ref_area: "AFG",
      source: "BA:15715",
      indicator: "SDG_B552_NOC_RT",
      time: "2021",
      obs_value: "",
      obs_status: "U",
      note_indicator: "",
      note_source: "R1:3513_S3:8",
    })

    expect(parsed.observations).toEqual([])
    expect(parsed.qualifications[0]).toMatchObject({
      missing: true,
      exclusion: "ReferencePeriod",
      status: { code: "U", label: "Unreliable" },
    })
  }),
)

it.effect(
  "gathers the selected asset once and serves its missing evidence without archive requests",
  () =>
    Effect.gen(function* () {
      const parsed = yield* record({
        ref_area: "AFG",
        source: "BA:15715",
        indicator: "SDG_B552_NOC_RT",
        time: "2021",
        obs_value: "",
        obs_status: "U",
        note_indicator: "",
        note_source: "R1:3513_S3:8",
      })

      let downloads = 0

      const disk = Layer.succeed(
        IlostatArchive,
        IlostatArchive.of({
          read: (version) => {
            downloads += 1

            return Stream.make({
              ...parsed,
              indicator: {
                id: indicator,
                name: "Women in senior and middle management",
                definition: "19th ICLS",
              },
              dataset: "ILOSTAT",
              version,
              retrievedAt: DateTime.makeUnsafe("2026-11-11T12:00:00Z"),
            })
          },
        }),
      )

      const source = yield* Ilostat.pipe(
        Effect.provide(
          Ilostat.layer.pipe(Layer.provide(disk), Layer.provide(http(() => new Response(toc)))),
        ),
      )

      const registered = Sources.of({
        "World Bank": source,
        Eurostat: source,
        OECD: source,
        ILOSTAT: source,
      })

      const store = bucket()
      yield* Effect.gen(function* () {
        yield* tables
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO catalog_current (source, generation) VALUES ('ILOSTAT', 1)`
        yield* sql`INSERT INTO catalog (source, generation, indicator, name, definition) VALUES ('ILOSTAT', 1, ${indicator}, 'Management', '19th ICLS')`
        yield* Gather.run("ILOSTAT").pipe(Effect.provide(Layer.merge(Gather.layer, Step.immediate)))
        yield* Gather.run("ILOSTAT").pipe(Effect.provide(Layer.merge(Gather.layer, Step.immediate)))
        const sources = yield* Sources.pipe(Effect.provide(Sources.stored))
        const adapter = yield* Sources.get(sources, indicator)

        const answer = yield* adapter.fetch({
          indicator,
          dimensions: parsed.dimensions,
          countries: ["AFG"],
          from: Year.make(2021),
          to: Year.make(2021),
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
          countries: ["AFG"],
          from: Year.make(2021),
          to: Year.make(2021),
        })

        const resolved = yield* resolver.resolve(view)
        expect(resolved.qualifications).toEqual(parsed.qualifications)
        expect(summarize(resolved).qualifications).toEqual(parsed.qualifications)
        expect(resolved.sources[0].dataset).toContain("BA:15715")
        expect(resolved.sources[0].url).toContain("SDG_B552_NOC_RT_A")

        const rejected = yield* resolver
          .resolve({ ...view, transform: "Growth" })
          .pipe(Effect.result)

        expect(rejected).toMatchObject({ failure: { indicator, transform: "Growth" } })
        expect(downloads).toBe(1)
      }).pipe(
        Effect.provideService(Sources, registered),
        Effect.provide(
          Layer.merge(Store.r2(store.bucket), D1Client.layer({ db: seriesDb }).pipe(Layer.orDie)),
        ),
      )
    }),
)
