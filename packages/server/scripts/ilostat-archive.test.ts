import { readFileSync } from "node:fs"
import { gzipSync } from "node:zlib"

import { expect, it } from "@effect/vitest"
import { Effect, Layer, Result, Stream } from "effect"
import { FetchHttpClient } from "effect/http"

import { archiveUrl, IlostatArchive, record, tocUrl } from "../src/sources/Ilostat.ts"
import { archiveLayer } from "./ilostat-archive.ts"

const csv = readFileSync(
  new URL("../../../docs/research/ilostat/SDG_B552_NOC_RT_A.csv", import.meta.url),
  "utf8",
)

const toc = readFileSync(new URL("../../../docs/research/ilostat/toc.csv", import.meta.url), "utf8")
const version = "05/11/2026 07:04:05"

const run = (answer: typeof fetch) =>
  Effect.gen(function* () {
    return yield* Stream.runCollect((yield* IlostatArchive).read(version))
  }).pipe(
    Effect.scoped,
    Effect.provide(archiveLayer.pipe(Layer.provide(FetchHttpClient.layer))),
    Effect.provideService(FetchHttpClient.Fetch, answer),
  )

it.effect(
  "streams the recorded archive into complete sorted surveys with missing and excluded evidence",
  () =>
    Effect.gen(function* () {
      const requests: Array<string> = []

      const series = yield* run((input) => {
        const url = new Request(input).url
        requests.push(url)

        return Promise.resolve(new Response(url === archiveUrl ? gzipSync(csv) : toc))
      })

      expect(requests).toEqual([archiveUrl, tocUrl])
      const qualifications = series.flatMap((item) => item.qualifications ?? [])
      expect(qualifications).toHaveLength(616)
      expect(series.flatMap((item) => item.observations)).toHaveLength(605)
      expect(qualifications.filter((item) => item.exclusion === "ReferencePeriod")).toHaveLength(10)
      expect(qualifications.filter((item) => item.status?.code === "U")).toHaveLength(10)
      expect(qualifications.filter((item) => item.status?.code === "B")).toHaveLength(42)
      expect(qualifications.filter((item) => item.missing)).toHaveLength(2)
      expect(qualifications.find((item) => item.country === "AFG")).toMatchObject({
        year: 2021,
        missing: true,
        exclusion: "ReferencePeriod",
        status: { label: "Unreliable" },
      })
      const keys = series.map((item) => JSON.stringify(item.dimensions))
      expect(keys).toEqual(keys.toSorted())
      expect(new Set(keys).size).toBe(keys.length)
    }),
)

it.effect("rejects a moving TOC before offering any series", () =>
  Effect.gen(function* () {
    const result = yield* run((input) =>
      Promise.resolve(
        new Response(
          new Request(input).url === archiveUrl
            ? gzipSync(csv)
            : toc.replaceAll(version, "06/11/2026 07:04:05"),
        ),
      ),
    ).pipe(Effect.result)

    expect(Result.isFailure(result)).toBe(true)
  }),
)

it.effect("reports a failed download through the archive error channel", () =>
  Effect.gen(function* () {
    const result = yield* run(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(new Error("download failed"))
            },
          }),
        ),
      ),
    ).pipe(Effect.result)

    expect(result).toMatchObject({ failure: { source: "ILOSTAT" } })
  }),
)

it.effect("rejects unknown notes, status codes and surveys", () =>
  Effect.gen(function* () {
    const valid = {
      ref_area: "AFG",
      source: "BA:15715",
      indicator: "SDG_B552_NOC_RT",
      time: "2021",
      obs_value: "",
      obs_status: "U",
      note_indicator: "",
      note_source: "R1:3513_S3:8",
    }

    for (const change of [
      { obs_status: "A" },
      { note_source: "S3:999" },
      { source: "NEW:1" },
      { obs_value: "NaN" },
    ]) {
      expect(Result.isFailure(yield* record({ ...valid, ...change }).pipe(Effect.result))).toBe(
        true,
      )
    }
  }),
)
