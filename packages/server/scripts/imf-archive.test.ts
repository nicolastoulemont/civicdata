import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

import { ResolvedView, Trend, Year } from "@openfacts/domain"
import { Effect, Layer, Option, Redacted, Result, Schema, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { expect, it } from "vitest"

import { AssetId } from "../src/Adapter.ts"
import { ledger } from "../src/GatherLedger.ts"
import { ImfArchive, growth } from "../src/Imf.ts"
import { Releases, releaseTables } from "../src/Releases.ts"
import { Stored, Store } from "../src/Store.ts"
import { summarize } from "../src/Summary.ts"
import { d1 } from "./d1.ts"
import { imfArchive } from "./imf-archive.ts"

const { indicator, selection } = growth

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

    const file = request.url.includes("FRA.NGDP") ? "FRA.csv" : "SWE.csv"

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
        readFileSync(new URL(`../../../docs/research/imf/${file}`, import.meta.url), "utf8"),
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

  const layer = imfArchive.pipe(Layer.provide(http), Layer.provideMerge(database))

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

it("persists successful inputs across sibling failures and retains exact values, status and vintage", async () => {
  const test = setup()
  test.fail("SWE.csv")

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const archive = yield* ImfArchive
        const release = yield* archive.release
        expect(
          Result.isFailure(
            yield* Stream.runCollect(archive.read(release.version)).pipe(Effect.result),
          ),
        ).toBe(true)
        test.fail("")
        const [stored] = yield* Stream.runCollect(archive.read(release.version))

        if (stored === undefined) throw new Error("Expected stored series")

        const resolved = yield* Schema.decodeUnknownEffect(ResolvedView)({
          view: Trend.make({
            indicator,
            countries: ["FRA", "SWE"],
            from: Year.make(2020),
            to: Year.make(2030),
          }),
          title: stored.indicator.name,
          indicator: stored.indicator,
          observations: stored.observations,
          qualifications: stored.qualifications,
          missing: [],
          dimensions: [],
          disagreements: [],
          direction: "Neutral",
          sources: [
            {
              indicator,
              name: stored.indicator.name,
              source: "IMF",
              dataset: stored.dataset,
              url: "https://data.imf.org/en/datasets/IMF.RES:WEO",
              retrievedAt: stored.retrievedAt,
              inputs: stored.inputs,
            },
          ],
        })

        expect(summarize(resolved).inputs).toEqual(stored.inputs)

        expect(summarize(resolved).qualifications).toEqual(stored.qualifications)

        expect(stored?.observations).toHaveLength(22)
        expect(stored?.observations[0]).toMatchObject({
          country: "FRA",
          year: 2020,
          value: -7.607135,
        })
        expect(
          stored?.qualifications?.find((item) => item.country === "FRA" && item.year === 2025),
        ).toMatchObject({
          vintage: "2026-10-13T02:00:00Z",
          latestActual: 2025,
          status: { code: "Actual" },
        })
        expect(
          stored?.qualifications?.find((item) => item.country === "SWE" && item.year === 2026),
        ).toMatchObject({ status: { code: "EstimateProjection" } })
        expect(stored?.inputs).toHaveLength(2)
        expect(stored?.inputs?.[0]).not.toHaveProperty("etag")
        expect(test.gets.filter((file) => file === "FRA.csv")).toHaveLength(1)
        expect(test.gets.filter((file) => file === "SWE.csv")).toHaveLength(2)
        yield* archive.verify(release.version)
        test.edit((file, text) =>
          file === "FRA.csv" ? text.replace("-7.607135", "-7.607134") : text,
        )
        expect(Result.isFailure(yield* archive.verify(release.version).pipe(Effect.result))).toBe(
          true,
        )
        const again = yield* Stream.runCollect(archive.read(release.version))
        expect(again).toEqual([stored])
      }).pipe(Effect.provide(test.layer)),
    )
  } finally {
    test.db.close()
  }
})

it.each([
  ["value revision", "-7.607135", "-7.607134"],
  ["cutoff revision", ",2025,National", ",2024,National"],
  ["unit mismatch", ",PT,", ",PD,"],
  ["country mismatch", ",FRA,", ",SWE,"],
  ["missing row", "2020,-7.607135", "2021,-7.607135"],
  ["empty response", "DATAFLOW", ""],
])("rejects %s without publishing a candidate", async (_name, before, after) => {
  const test = setup()
  test.edit((file, text) => (file === "FRA.csv" ? text.replaceAll(before, after) : text))

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const archive = yield* ImfArchive
        const release = yield* archive.release
        expect(
          Result.isFailure(
            yield* Stream.runCollect(archive.read(release.version)).pipe(Effect.result),
          ),
        ).toBe(true)
      }).pipe(Effect.provide(test.layer)),
    )
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
        const archive = yield* ImfArchive
        const release = yield* archive.release
        const series = yield* Stream.runCollect(archive.read(release.version))
        const store = yield* Store
        yield* Stream.runDrain(store.write(indicator, Stream.fromIterable(series)))
        const restored = yield* store.read({ indicator, dimensions: selection })
        expect(restored).toHaveProperty("value.inputs", series[0]?.inputs)
        const first = series[0]

        if (first === undefined) throw new Error("Expected series")
        expect(Schema.is(Stored)(Object.assign({}, first, { qualifications: undefined }))).toBe(
          false,
        )

        const revised = yield* Schema.decodeUnknownEffect(Stored)(
          Object.assign({}, first, {
            qualifications: first.qualifications?.map((item) =>
              Object.assign({}, item, {
                notes: [
                  ...item.notes,
                  { category: "Publisher", code: "REVISION", label: "Reviewed note-only revision" },
                ],
              }),
            ),
          }),
        )

        yield* Stream.runDrain(store.write(indicator, Stream.make(revised)))
        const updated = yield* store.read({ indicator, dimensions: selection })
        expect(updated).toHaveProperty("value.qualifications", revised.qualifications)
        yield* releaseTables
        const releases = yield* Releases.pipe(Effect.provide(Releases.layer))
        const prepared = yield* releases.prepare("IMF", release)

        if (Option.isNone(prepared)) throw new Error("Expected manifest")
        expect(
          Result.isFailure(yield* releases.activate("IMF", prepared.value).pipe(Effect.result)),
        ).toBe(true)
        const progress = yield* ledger(`/${prepared.value.namespace}`)
        yield* progress.stored(AssetId.make("countries"), {
          source: "IMF",
          version: release.version,
        })
        yield* releases.activate("IMF", prepared.value)

        const next = yield* releases.prepare("IMF", {
          assets: release.assets,
          version: "next",
          order: release.order + 1,
        })

        if (Option.isNone(next)) throw new Error("Expected next manifest")
        expect(
          Result.isFailure(yield* releases.activate("IMF", next.value).pipe(Effect.result)),
        ).toBe(true)
        expect(yield* releases.current("IMF")).toEqual(prepared)
        expect(Schema.is(Stored)(series[0])).toBe(true)
      }).pipe(Effect.provide(Layer.merge(test.layer, bucket))),
    )
  } finally {
    test.db.close()
  }
})
