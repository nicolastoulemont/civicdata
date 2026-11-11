import { createHash } from "node:crypto"

import { Input, SourceUnavailable } from "@openfacts/domain"
import { DateTime, Duration, Effect, Layer, Schema, Stream } from "effect"
import { HttpClient } from "effect/http"
import { SqlClient } from "effect/sql"

import { AssetId, Release } from "../src/Adapter.ts"
import { collect } from "../src/Inputs.ts"
import { Stored } from "../src/Store.ts"
import { table } from "../src/Table.ts"
import { income, WidArchive } from "../src/Wid.ts"
import { metadata as Metadata, record } from "./wid-record.ts"

const { indicator, name, definition, dataset, units, selection } = income

const unavailable = () => new SourceUnavailable({ source: "WID" })

const Stamp = Schema.Struct({
  url: Schema.NonEmptyString,
  etag: Schema.NonEmptyString,
  lastModified: Schema.NonEmptyString,
})

const Stamps = Schema.fromJsonString(Schema.NonEmptyArray(Stamp))

const Fragment = Schema.toCodecJson(
  Schema.Struct({ input: Input, rows: Schema.Array(Schema.Record(Schema.String, Schema.String)) }),
)

export const widArchive = Layer.effect(
  WidArchive,
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
    const sql = yield* SqlClient.SqlClient

    const urls = units.flatMap(({ native }) =>
      ["data", "metadata"].map(
        (kind) => `https://wid.world/bulk_download/WID_${kind}_${native}.csv`,
      ),
    )

    const stamps = Effect.fn("Wid.stamps")(function* () {
      return yield* Effect.forEach(urls, (url) =>
        Effect.gen(function* () {
          const response = yield* client.head(url)

          const stamp = yield* Schema.decodeUnknownEffect(Stamp)({
            url,
            etag: response.headers["etag"],
            lastModified: response.headers["last-modified"],
          })

          if (stamp.etag.startsWith("W/") || !Number.isFinite(Date.parse(stamp.lastModified)))
            return yield* unavailable()

          return stamp
        }),
      )
    })

    const verify = Effect.fn("Wid.verify")(
      function* (version: string) {
        const expected = yield* Schema.decodeUnknownEffect(Stamps)(version)

        if (JSON.stringify(yield* stamps()) !== JSON.stringify(expected))
          return yield* unavailable()

        return undefined
      },
      Effect.timeout(Duration.minutes(1)),
      Effect.mapError(unavailable),
    )

    const fragments = Effect.fn("Wid.fragments")(function* (version: string) {
      const selected = yield* Schema.decodeUnknownEffect(Stamps)(version)

      if (selected.length !== urls.length || selected.some((stamp, at) => stamp.url !== urls[at]))
        return yield* unavailable()

      const values = yield* collect(
        "WID",
        selected.map((stamp) => ({
          asset: AssetId.make(stamp.url.split("/").at(-1) ?? ""),
          version: JSON.stringify(stamp),
          fetch: Effect.gen(function* () {
            const response = yield* client.get(stamp.url)

            if (
              response.headers["etag"] !== stamp.etag ||
              response.headers["last-modified"] !== stamp.lastModified
            )
              return yield* unavailable()
            const retrievedAt = yield* DateTime.now
            const hash = createHash("sha256")
            let bytes = 0
            const metadata = stamp.url.includes("metadata")
            const selectedLines: Array<string> = []
            let header = ""
            const chunks: Array<string> = []
            yield* response.stream.pipe(
              Stream.tap((chunk) =>
                Effect.sync(() => {
                  bytes += chunk.byteLength
                  hash.update(chunk)
                }),
              ),
              Stream.tap(() =>
                bytes > (metadata ? 8_000_000 : 128_000_000)
                  ? Effect.fail(unavailable())
                  : Effect.void,
              ),
              Stream.decodeText(),
              metadata
                ? Stream.runForEach((chunk) =>
                    Effect.sync(() => {
                      chunks.push(chunk)
                    }),
                  )
                : (stream) =>
                    stream.pipe(
                      Stream.splitLines,
                      Stream.runForEach((line) =>
                        Effect.sync(() => {
                          if (header === "") header = line
                          else {
                            const cells = line.split(";")

                            if (
                              cells[1] === "sptinc992j" &&
                              ["p0p50", "p90p100"].includes(cells[2] ?? "") &&
                              Number(cells[3]) >= 1991 &&
                              Number(cells[3]) <= 2024
                            )
                              selectedLines.push(line)
                          }
                        }),
                      ),
                    ),
            )

            const parsed = yield* table(
              metadata ? chunks.join("") : `${header}\n${selectedLines.join("\n")}\n`,
              ";",
            )

            const native = stamp.url.includes("_FR.") ? "FR" : "SE"

            const rows = parsed.filter(
              (row) =>
                row["variable"] === "sptinc992j" &&
                (metadata ||
                  (["p0p50", "p90p100"].includes(row["percentile"] ?? "") &&
                    Number(row["year"]) >= 1991 &&
                    Number(row["year"]) <= 2024)),
            )

            if (
              rows.length !== (metadata ? 1 : 68) ||
              rows.some(
                (row) => row["country"] !== native || row["age"] !== "992" || row["pop"] !== "j",
              )
            )
              return yield* unavailable()

            return yield* Schema.encodeEffect(Fragment)({
              input: {
                ...stamp,
                version: JSON.stringify(stamp),
                retrievedAt,
                sha256: hash.digest("hex"),
              },
              rows,
            })
          }).pipe(Effect.timeout(Duration.minutes(5)), Effect.mapError(unavailable)),
        })),
      ).pipe(Effect.provideService(SqlClient.SqlClient, sql))

      return yield* Effect.forEach(values, (value) => Schema.decodeUnknownEffect(Fragment)(value))
    }, Effect.mapError(unavailable))

    const country = Effect.fn("Wid.country")(function* (
      unit: (typeof units)[number],
      options: { data: typeof Fragment.Type | undefined; metadata: unknown; percentile: string },
    ) {
      const metadata = yield* Schema.decodeUnknownEffect(Metadata)(options.metadata)
      const data = options.data

      if (data === undefined || metadata.countryname !== unit.name) return yield* unavailable()

      const selected = yield* Effect.forEach(
        data.rows.filter((point) => point["percentile"] === options.percentile),
        (row) => record(row, { country: unit.country, percentile: options.percentile, metadata }),
      )

      const years = new Set(selected.map((item) => item.qualification.year))

      if (selected.length !== 34 || years.size !== 34) return yield* unavailable()

      return selected
    })

    const assemble = Effect.fn("Wid.assemble")(function* (version: string) {
      const saved = yield* fragments(version)
      const inputs: Array<Input> = saved.map((fragment) => fragment.input)

      return yield* Effect.forEach(["p0p50", "p90p100"], (percentile) =>
        Effect.gen(function* () {
          const countries = yield* Effect.forEach(units, (unit, at) =>
            country(unit, {
              data: saved[at * 2],
              metadata: saved[at * 2 + 1]?.rows[0],
              percentile,
            }),
          )

          const records = countries.flat()

          return yield* Schema.decodeUnknownEffect(Stored)({
            indicator: { id: indicator, name, definition },
            dataset,
            dimensions: selection(percentile),
            version,
            retrievedAt: yield* DateTime.now,
            inputs,
            observations: records.flatMap((item) => item.observations),
            qualifications: records.map((item) => item.qualification),
          })
        }),
      )
    }, Effect.mapError(unavailable))

    return WidArchive.of({
      release: Effect.gen(function* () {
        const selected = yield* stamps()

        const version = yield* Schema.encodeEffect(Stamps)(
          yield* Schema.decodeUnknownEffect(Schema.NonEmptyArray(Stamp))(selected),
        )

        yield* fragments(version)
        yield* verify(version)

        return yield* Schema.decodeUnknownEffect(Release)({
          version,
          order: Math.max(...selected.map((stamp) => Date.parse(stamp.lastModified))),
          assets: [
            {
              asset: AssetId.make("countries"),
              members: ["p0p50", "p90p100"].map((percentile) => ({
                indicator,
                dimensions: selection(percentile),
              })),
            },
          ],
        })
      }).pipe(Effect.timeout(Duration.minutes(5)), Effect.mapError(unavailable)),
      read: (version) => Stream.unwrap(assemble(version).pipe(Effect.map(Stream.fromIterable))),
      verify,
    })
  }),
)
