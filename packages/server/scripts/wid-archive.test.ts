import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

import { ResolvedView, Trend, Year } from "@repo/domain"
import { Effect, Layer, Option, Redacted, Result, Schema, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { expect, it } from "vitest"

import { AssetId } from "../src/series/Adapter.schemas.ts"
import { ledger } from "../src/series/GatherLedger.ts"
import { Releases, releaseTables } from "../src/series/Releases.ts"
import { Stored } from "../src/series/Store.schemas.ts"
import { Store } from "../src/series/Store.ts"
import { WidArchive, income } from "../src/sources/Wid.ts"
import { summarize } from "../src/views/utils/summarize.ts"
import { d1 } from "./d1.ts"
import { widArchive } from "./wid-archive.ts"

const { indicator, selection } = income

const Query = Schema.Struct({
  sql: Schema.String,
  params: Schema.Array(Schema.Union([Schema.String, Schema.Finite, Schema.Null])),
})

const unchanged = (_file: string, text: string) => text

const setup = () => {
  const db = new DatabaseSync(":memory:")
  const gets: Array<string> = []
  let fail = ""
  let changed = false
  let edit = unchanged

  const wire: typeof fetch = async (input, init) => {
    const request = new Request(input, init)

    if (request.url.startsWith("https://api.cloudflare.com/")) {
      const { sql, params } = Schema.decodeUnknownSync(Query)(await request.json())
      const statement = db.prepare(sql)
      const results = statement.all(...params)

      return Response.json({
        result: [{ results, meta: { rows_read: results.length, rows_written: 0, size_after: 0 } }],
      })
    }

    const file = request.url.split("/").at(-1) ?? ""

    const headers = {
      etag: `"${file}${changed ? "-changed" : ""}"`,
      "last-modified": "Fri, 06 Nov 2026 17:03:44 GMT",
    }

    if (request.method === "HEAD") return new Response(null, { headers })
    gets.push(file)

    if (file === fail) return new Response(null, { status: 503 })

    return new Response(
      edit(
        file,
        readFileSync(new URL(`../../../docs/research/wid/${file}`, import.meta.url), "utf8"),
      ),
      { headers },
    )
  }

  const http = FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, wire)))

  const database = d1({
    account: "test",
    database: "test",
    token: Redacted.make("test"),
  }).layer.pipe(Layer.provide(http))

  const layer = widArchive.pipe(Layer.provide(http), Layer.provideMerge(database))

  return {
    db,
    edit: (change: typeof edit) => {
      edit = change
    },
    gets,
    layer,
    fail: (value: string) => {
      fail = value
    },
    change: () => {
      changed = true
    },
  }
}

it("reuses persisted successful inputs after a sibling failure and assembles complete country series with original fractions and provenance", async () => {
  const test = setup()
  test.fail("WID_data_SE.csv")

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const archive = yield* WidArchive
        expect(Result.isFailure(yield* archive.release.pipe(Effect.result))).toBe(true)
        test.fail("")
        const release = yield* archive.release
        const series = yield* Stream.runCollect(archive.read(release.version))
        expect(series).toHaveLength(2)

        for (const item of series) {
          expect(item.observations).toHaveLength(68)
          expect(new Set(item.observations.map((point) => point.country))).toEqual(
            new Set(["FRA", "SWE"]),
          )
          expect(item.inputs).toHaveLength(4)

          const resolved = yield* Schema.decodeUnknownEffect(ResolvedView)({
            view: Trend.make({
              indicator,
              countries: ["FRA", "SWE"],
              from: Year.make(1991),
              to: Year.make(2024),
            }),
            title: item.indicator.name,
            indicator: item.indicator,
            observations: item.observations,
            qualifications: item.qualifications,
            missing: [],
            dimensions: [],
            disagreements: [],
            direction: "Neutral",
            sources: [
              {
                indicator,
                name: item.indicator.name,
                source: "WID",
                dataset: item.dataset,
                url: "https://wid.world/data/",
                retrievedAt: item.retrievedAt,
                inputs: item.inputs,
              },
            ],
          })

          expect(summarize(resolved).inputs).toEqual(item.inputs)
          expect(item.inputs?.every((input) => /^[a-f0-9]{64}$/.test(input.sha256))).toBe(true)
          expect(
            item.qualifications?.every((qualification) =>
              qualification.notes.some((note) => note.category === "Method"),
            ),
          ).toBe(true)
        }

        expect(series[0]?.observations[0]?.value).toBe(0.2194)
        expect(test.gets.filter((file) => file === "WID_data_FR.csv")).toHaveLength(1)
        expect(test.gets.filter((file) => file === "WID_data_SE.csv")).toHaveLength(2)

        // A fresh service acquisition reads the same persisted fragments.
        return release.version
      }).pipe(Effect.provide(test.layer)),
    ).then(async (version) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const archive = yield* WidArchive
          expect(yield* Stream.runCollect(archive.read(version))).toHaveLength(2)
          test.change()
          expect(Result.isFailure(yield* archive.verify(version).pipe(Effect.result))).toBe(true)
        }).pipe(Effect.provide(test.layer)),
      )
    })
    expect(test.gets).toHaveLength(5)
  } finally {
    test.db.close()
  }
})

it("persists full per-input evidence in immutable packs and keeps the old release when activation is incomplete", async () => {
  const test = setup()
  const objects = new Map<string, { text: string; customMetadata: Record<string, string> }>()

  const bucket = Store.r2({
    get: async (key) => {
      const value = objects.get(key)

      return value === undefined
        ? null
        : { text: async () => value.text, customMetadata: value.customMetadata }
    },
    put: async (key, text, options) => {
      if (options.onlyIf !== undefined && objects.has(key)) return null
      objects.set(key, { text, customMetadata: options.customMetadata })

      return { key }
    },
    delete: async (keys) => {
      for (const key of keys) objects.delete(key)
    },
  })

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const archive = yield* WidArchive
        const release = yield* archive.release
        const series = yield* Stream.runCollect(archive.read(release.version))
        const store = yield* Store
        yield* Stream.runDrain(store.write(indicator, Stream.fromIterable(series)))
        const restored = yield* store.read({ indicator, dimensions: selection("p0p50") })
        expect(restored).toHaveProperty("value.inputs", series[0]?.inputs)
        yield* releaseTables
        const releases = yield* Releases.pipe(Effect.provide(Releases.layer))
        const prepared = yield* releases.prepare("WID", release)

        if (Option.isNone(prepared)) throw new Error("Expected manifest")
        expect(
          Result.isFailure(yield* releases.activate("WID", prepared.value).pipe(Effect.result)),
        ).toBe(true)
        const progress = yield* ledger(`/${prepared.value.namespace}`)
        yield* progress.stored(AssetId.make("countries"), {
          source: "WID",
          version: release.version,
        })
        yield* releases.activate("WID", prepared.value)

        const next = yield* releases.prepare("WID", {
          assets: release.assets,
          version: "next",
          order: release.order + 1,
        })

        if (Option.isNone(next)) throw new Error("Expected next manifest")
        expect(
          Result.isFailure(yield* releases.activate("WID", next.value).pipe(Effect.result)),
        ).toBe(true)
        expect(yield* releases.current("WID")).toEqual(prepared)
        expect(Schema.is(Stored)(series[0])).toBe(true)
      }).pipe(Effect.provide(Layer.merge(test.layer, bucket))),
    )
  } finally {
    test.db.close()
  }
})

it("rejects changed identities, invalid fractions and unknown quality while retaining explicit missing values", async () => {
  await Promise.all(
    [
      ["FR;sptinc992j", "XX;sptinc992j"],
      [";0.2194;", ";21.94;"],
      [";992;j;5", ";992;j;9"],
    ].map(async ([before, after]) => {
      const test = setup()
      test.edit((file, text) =>
        file === "WID_data_FR.csv" ? text.replace(before ?? "", after ?? "") : text,
      )

      try {
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const archive = yield* WidArchive
            const release = yield* archive.release

            return yield* Stream.runCollect(archive.read(release.version))
          }).pipe(Effect.result, Effect.provide(test.layer)),
        )

        expect(Result.isFailure(result)).toBe(true)
      } finally {
        test.db.close()
      }
    }),
  )
  const test = setup()
  test.edit((file, text) => (file === "WID_data_FR.csv" ? text.replace(";0.2194;", ";;") : text))

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const archive = yield* WidArchive
        const release = yield* archive.release
        const series = yield* Stream.runCollect(archive.read(release.version))
        expect(series[0]?.observations).toHaveLength(67)
        expect(series[0]?.qualifications?.[0]).toMatchObject({
          country: "FRA",
          year: 1991,
          missing: true,
        })
      }).pipe(Effect.provide(test.layer)),
    )
  } finally {
    test.db.close()
  }
})
