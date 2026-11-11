import { createHash } from "node:crypto"

import { Country, Input, Qualification, SourceUnavailable } from "@openfacts/domain"
import { DateTime, Duration, Effect, Layer, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { SqlClient } from "effect/sql"

import { AssetId, Release } from "../src/Adapter.ts"
import { growth, ImfArchive } from "../src/Imf.ts"
import { collect } from "../src/Inputs.ts"
import { Stored } from "../src/Store.ts"
import { record } from "./imf-record.ts"

const { indicator, name, definition, dataset, units, selection } = growth

const hashes = [
  "bdccd9d4a42b4fe8ac6fceb830ef4cb18634f1d2dbe73d9adcaccedcb62ca605",
  "220b5921b5ef6f3e62e07677620004e883b8795a2ba9e19f35e55d1cda8f595b",
]

const vintage = "2026-10-13T02:00:00Z"
const version = `${vintage}/${hashes.join("/")}`
const unavailable = () => new SourceUnavailable({ source: "IMF" })

const Fragment = Schema.toCodecJson(
  Schema.Struct({
    input: Input,
    observations: Stored.fields.observations,
    qualifications: Schema.Array(Qualification),
  }),
)

// This is a reviewed snapshot of a mutable route, not an immutable IMF release URL.
export const imfArchive = Layer.effect(
  ImfArchive,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

    const fetch = Effect.fn("Imf.input")(
      function* (country: Country, sha256: string) {
        const url = `https://api.imf.org/external/sdmx/2.1/data/IMF.RES,WEO,latest/${country}.NGDP_RPCH.A?startPeriod=2020&endPeriod=2030`

        const response = yield* client.execute(
          HttpClientRequest.get(url).pipe(
            HttpClientRequest.setHeader("Accept", "application/vnd.sdmx.data+csv;version=2.0.0"),
          ),
        )

        const text = yield* response.text

        if (text.length > 100_000 || createHash("sha256").update(text).digest("hex") !== sha256)
          return yield* unavailable()
        const { observations, qualifications } = yield* record(text, { country, vintage })

        return yield* Schema.encodeEffect(Fragment)({
          input: { url, sha256, version: sha256, retrievedAt: yield* DateTime.now },
          observations,
          qualifications,
        })
      },
      Effect.timeout(Duration.minutes(1)),
      Effect.mapError(unavailable),
    )

    const fragments = Effect.fn("Imf.fragments")(function* () {
      const saved = yield* collect(
        "IMF",
        units.map((country, at) => ({
          asset: AssetId.make(country),
          version: hashes[at] ?? "",
          fetch: fetch(country, hashes[at] ?? ""),
        })),
      ).pipe(Effect.provideService(SqlClient.SqlClient, sql))

      return yield* Effect.forEach(saved, (value) => Schema.decodeUnknownEffect(Fragment)(value))
    }, Effect.mapError(unavailable))

    return ImfArchive.of({
      release: Effect.succeed(
        Release.make({
          version,
          order: Date.parse(vintage),
          assets: [
            { asset: AssetId.make("countries"), members: [{ indicator, dimensions: selection }] },
          ],
        }),
      ),
      verify: (candidate) =>
        candidate !== version
          ? Effect.fail(unavailable())
          : Effect.forEach(units, (country, at) => fetch(country, hashes[at] ?? "")).pipe(
              Effect.asVoid,
            ),
      read: (candidate) =>
        Stream.fromEffect(
          Effect.gen(function* () {
            if (candidate !== version) return yield* unavailable()
            const saved = yield* fragments()

            return yield* Schema.decodeUnknownEffect(Stored)({
              indicator: { id: indicator, name, definition },
              dataset,
              dimensions: selection,
              version,
              retrievedAt: saved[0]?.input.retrievedAt ?? (yield* DateTime.now),
              inputs: saved.map((item) => item.input),
              observations: saved.flatMap((item) => item.observations),
              qualifications: saved.flatMap((item) => item.qualifications),
            })
          }).pipe(Effect.mapError(unavailable)),
        ),
    })
  }),
)
