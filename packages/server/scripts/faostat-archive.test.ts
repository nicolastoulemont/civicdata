import { readFileSync } from "node:fs"

import { expect, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import { FetchHttpClient } from "effect/http"

import { asti, FaostatArchive } from "../src/Faostat.ts"
import { faoArchive } from "./faostat-archive.ts"

const { archiveUrl, manifestUrl, versionOf } = asti

const zip = readFileSync(new URL("../../../docs/research/faostat/AE.zip", import.meta.url))

const manifest = readFileSync(
  new URL("../../../docs/research/faostat/manifest.json", import.meta.url),
  "utf8",
)

const run = (answer: typeof fetch) =>
  Effect.gen(function* () {
    const version = yield* versionOf(manifest)

    return yield* Stream.runCollect((yield* FaostatArchive).read(version))
  }).pipe(
    Effect.scoped,
    Effect.provide(faoArchive.pipe(Layer.provide(FetchHttpClient.layer))),
    Effect.provideService(FetchHttpClient.Fetch, answer),
  )

it.effect("parses the official complete domain into one sorted national percentage series", () =>
  Effect.gen(function* () {
    const requests: Array<string> = []

    const series = yield* run((input) => {
      const url = new Request(input).url
      requests.push(url)

      return Promise.resolve(new Response(url === archiveUrl ? zip : manifest))
    })

    expect(requests).toEqual([archiveUrl, manifestUrl])
    expect(series).toHaveLength(1)
    const data = series[0]
    expect(data?.observations.length).toBe(1305)
    expect(data?.observations.some((row) => row.country === "CHN")).toBe(false)
    const places = data?.observations.map((row) => `${row.country}:${row.year}`) ?? []
    expect(places).toEqual(places.toSorted())
    expect(new Set(places).size).toBe(places.length)
    expect(data?.qualifications?.length).toBe(places.length)
    expect(data?.qualifications?.some((row) => row.status?.code === "I")).toBe(true)
    expect(
      data?.observations.find((row) => row.country === "ARG" && row.year === 2010)?.value,
    ).toBe(0.99)
  }),
)

it.effect("rejects a moving manifest without offering data", () =>
  Effect.gen(function* () {
    const result = yield* run((input) =>
      Promise.resolve(
        new Response(
          new Request(input).url === archiveUrl
            ? zip
            : manifest.replaceAll("2026-04-30", "2026-05-01"),
        ),
      ),
    ).pipe(Effect.result)

    expect(result).toMatchObject({ failure: { source: "FAOSTAT" } })
  }),
)

it.effect("keeps a body failure in the typed archive error channel", () =>
  Effect.gen(function* () {
    const result = yield* run(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(new Error("broken body"))
            },
          }),
        ),
      ),
    ).pipe(Effect.result)

    expect(result).toMatchObject({ failure: { source: "FAOSTAT" } })
  }),
)
