import { execFile } from "node:child_process"
import { createReadStream } from "node:fs"
import { open } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

import { NodeStream } from "@effect/platform-node"
import { SourceUnavailable } from "@openfacts/domain"
import { DateTime, Effect, Layer, Stream } from "effect"
import { HttpClient } from "effect/http"

import { asti, FaostatArchive } from "../src/Faostat.ts"
import { table } from "../src/Table.ts"
import { scratch, sortRows, series } from "./series.ts"

const { archiveUrl, dataset, name, definition, indicator, record, currentVersion } = asti

const unavailable = () => new SourceUnavailable({ source: "FAOSTAT" })

// The complete asset is validated and its manifest rechecked before any series is
// offered. Disk holds the asset; memory holds one CSV row or the selected national measure.
export const faoArchive = Layer.effect(
  FaostatArchive,
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.filterStatusOk,
      HttpClient.retryTransient({ times: 2 }),
    )

    return FaostatArchive.of({
      read: (version) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const folder = yield* scratch("FAOSTAT")

            const response = yield* client.get(archiveUrl)
            const retrievedAt = yield* DateTime.now
            const zip = join(folder, "AE.zip")
            const download = yield* Effect.tryPromise(() => open(zip, "w"))
            yield* response.stream.pipe(
              Stream.runForEach((chunk) => Effect.tryPromise(() => download.write(chunk))),
              Effect.ensuring(Effect.promise(() => download.close())),
            )
            // Only this reviewed member is extracted. The ZIP is never opened in Workers.
            const csv = "ASTI_Expenditures_E_All_Data_(Normalized).csv"
            yield* Effect.tryPromise({
              try: (signal) =>
                promisify(execFile)("unzip", ["-q", zip, csv, "-d", folder], { signal }),
              catch: unavailable,
            })
            const staged = join(folder, "rows")
            const sorted = join(folder, "sorted")
            const output = yield* Effect.tryPromise(() => open(staged, "w"))
            let header: string | undefined
            let count = 0
            let selected = 0

            yield* NodeStream.fromReadable({
              evaluate: () => createReadStream(join(folder, csv)),
              onError: unavailable,
            }).pipe(
              Stream.decodeText(),
              Stream.splitLines,
              Stream.mapEffect(
                Effect.fn(function* (line) {
                  if (header === undefined) {
                    header = line.replace(/^\uFEFF/, "")

                    return undefined
                  }

                  if (line === "") return undefined
                  const rows = yield* table(`${header}\n${line}\n`)

                  if (rows.length !== 1) return yield* unavailable()
                  count += 1
                  const row = yield* record(rows[0] ?? {})

                  if (row === undefined) return undefined
                  selected += 1
                  const place = row.qualifications[0]

                  if (place === undefined) return yield* unavailable()
                  yield* Effect.tryPromise(() =>
                    output.write(`${place.country}:${place.year}\t${JSON.stringify(row)}\n`),
                  )

                  return undefined
                }),
              ),
              Stream.runDrain,
              Effect.ensuring(Effect.promise(() => output.close())),
            )

            if (selected === 0 || count !== Number(version.split("/")[1]))
              return yield* unavailable()
            yield* sortRows(staged, sorted)

            const after = yield* currentVersion(client)

            if (after !== version) return yield* unavailable()

            return series(sorted, {
              indicator: { id: indicator, name, definition },
              dataset: `FAO. ${version.slice(0, 4)}. ${dataset}; publisher update ${version.split("/")[0]}`,
              version,
              retrievedAt,
            })
          }).pipe(Effect.mapError(unavailable)),
        ),
    })
  }),
)
