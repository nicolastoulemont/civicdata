import { open } from "node:fs/promises"
import { join } from "node:path"
import { createGunzip } from "node:zlib"

import { NodeStream } from "@effect/platform-node"
import { SourceUnavailable } from "@repo/domain"
import { DateTime, Effect, Layer, Stream } from "effect"
import { HttpClient } from "effect/http"

import {
  archiveUrl,
  dataset,
  name,
  definition,
  IlostatArchive,
  indicator,
  record,
  tocUrl,
  versionOf,
} from "../src/Ilostat.ts"
import { table } from "../src/Table.ts"
import { scratch, sortRows, series } from "./series.ts"

const unavailable = () => new SourceUnavailable({ source: "ILOSTAT" })

// The complete asset is validated and its TOC rechecked before any series is
// offered. Disk holds the asset; memory holds one CSV row or one survey series.
export const archiveLayer = Layer.effect(
  IlostatArchive,
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.filterStatusOk,
      HttpClient.retryTransient({ times: 2 }),
    )

    return IlostatArchive.of({
      read: (version) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const folder = yield* scratch("ILOSTAT")

            const response = yield* client.get(archiveUrl)
            const retrievedAt = yield* DateTime.now
            const staged = join(folder, "rows")
            const sorted = join(folder, "sorted")
            const output = yield* Effect.tryPromise(() => open(staged, "w"))
            let header: string | undefined
            // Keep download and gzip failures in the Effect stream, including
            // interruption and cleanup, rather than a detached Node pipe.
            yield* response.stream.pipe(
              NodeStream.pipeThroughDuplex({ evaluate: createGunzip, onError: unavailable }),
              Stream.decodeText(),
              Stream.splitLines,
              Stream.mapEffect(
                Effect.fn(function* (line) {
                  if (header === undefined) {
                    header = line

                    return undefined
                  }

                  const rows = yield* table(`${header}\n${line}\n`)

                  if (rows.length !== 1) return yield* unavailable()
                  const row = yield* record(rows[0] ?? {})

                  if (row.qualifications.length === 0) return undefined
                  const code = Object.values(row.dimensions)[0]
                  yield* Effect.tryPromise(() => output.write(`${code}\t${JSON.stringify(row)}\n`))

                  return undefined
                }),
              ),
              Stream.runDrain,
              Effect.ensuring(Effect.promise(() => output.close())),
            )
            yield* sortRows(staged, sorted)

            const after = yield* client.get(tocUrl).pipe(
              Effect.flatMap((answer) => answer.text),
              Effect.flatMap(versionOf),
            )

            if (after !== version) return yield* unavailable()

            return series(sorted, {
              indicator: { id: indicator, name, definition },
              dataset,
              version,
              retrievedAt,
            })
          }).pipe(Effect.mapError(unavailable)),
        ),
    })
  }),
)
