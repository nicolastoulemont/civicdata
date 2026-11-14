import { open } from "node:fs/promises"
import { join } from "node:path"

import { ConfigProvider, DateTime, Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { expect, it } from "vitest"

import records from "../../../docs/research/vdem/records.json" with { type: "json" }
import { polyarchy, VdemArchive } from "../src/sources/Vdem.ts"
import { scratch, series, sortRows } from "./series.ts"
import { vdemArchive } from "./vdem-archive.ts"

it("rejects altered archive bytes before any native parser runs", async () => {
  const requests: Array<string> = []

  const client = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      requests.push(request.url)

      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("wrong archive")))
    }),
  )

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const archive = yield* VdemArchive

      return yield* Stream.runCollect(archive.read).pipe(Effect.result)
    }).pipe(
      Effect.provide(vdemArchive.pipe(Layer.provide(client))),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({ VDEM_PYTHON: "/does-not-exist" }),
      ),
      Effect.scoped,
    ),
  )

  expect(result).toMatchObject({ failure: { source: "V-Dem" } })
  expect(requests).toEqual([polyarchy.archiveUrl])
})

it("assembles recorded original-publisher values and bounds through the real disk sort and series decoder", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const folder = yield* scratch("V-Dem")
      const staged = join(folder, "rows")
      const sorted = join(folder, "sorted")
      const output = yield* Effect.tryPromise(() => open(staged, "w"))

      for (const raw of records.toReversed()) {
        const row = yield* polyarchy.record(raw)

        if (row === undefined) return yield* Effect.die("Fixture excluded")
        yield* Effect.tryPromise(() =>
          output.write(`${raw.country_text_id}:${raw.year}\t${JSON.stringify(row)}\n`),
        )
      }

      yield* Effect.promise(() => output.close())
      yield* sortRows(staged, sorted)

      return yield* Stream.runCollect(
        series(sorted, {
          indicator: {
            id: polyarchy.indicator,
            name: polyarchy.name,
            definition: polyarchy.definition,
          },
          dataset: polyarchy.dataset,
          version: polyarchy.version,
          retrievedAt: DateTime.makeUnsafe("2026-11-11T12:00:00Z"),
        }),
      )
    }).pipe(Effect.scoped),
  )

  expect(result).toHaveLength(1)
  expect(result[0]?.qualifications).toHaveLength(6)
  expect(result[0]?.observations).toHaveLength(6)
  expect(result[0]?.qualifications?.[2]).toMatchObject({
    country: "FRA",
    year: 2025,
    interval: { lower: 0.828, upper: 0.914 },
  })
})
