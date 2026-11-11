import { execFile } from "node:child_process"
import { createReadStream } from "node:fs"
import { mkdtemp, open, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { promisify } from "node:util"
import { createGunzip } from "node:zlib"

import { NodeStream } from "@effect/platform-node"
import { SourceUnavailable } from "@openfacts/domain"
import { DateTime, Effect, Layer, Schema, Stream } from "effect"
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
import { Stored } from "../src/Store.ts"
import { table } from "../src/Table.ts"

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
            const folder = yield* Effect.acquireRelease(
              Effect.tryPromise(() => mkdtemp(join(tmpdir(), "ilostat-"))),
              (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
            )

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
            yield* Effect.tryPromise(() =>
              promisify(execFile)("sort", ["-o", sorted, staged], {
                env: { ...process.env, LC_ALL: "C" },
              }),
            )

            const after = yield* client.get(tocUrl).pipe(
              Effect.flatMap((answer) => answer.text),
              Effect.flatMap(versionOf),
            )

            if (after !== version) return yield* unavailable()

            const headerFields = {
              indicator: { id: indicator, name, definition },
              dataset,
              version,
              retrievedAt,
            }

            const records = createInterface({
              input: createReadStream(sorted),
              crlfDelay: Infinity,
            })

            const grouped = async function* () {
              let rows: Array<Stored> = []
              let key = ""

              for await (const line of records) {
                const row = await Effect.runPromise(
                  Schema.decodeUnknownEffect(Stored)({
                    ...headerFields,
                    ...JSON.parse(line.slice(line.indexOf("\t") + 1)),
                  }),
                )

                const next = JSON.stringify(row.dimensions)

                if (rows.length > 0 && next !== key) {
                  yield assemble(rows)
                  rows = []
                }

                rows.push(row)
                key = next
              }

              if (rows.length > 0) yield assemble(rows)
            }

            return Stream.fromAsyncIterable(grouped(), unavailable)
          }).pipe(Effect.mapError(unavailable)),
        ),
    })
  }),
)

// Each complete survey series contains each country-year once.
const assemble = (rows: ReadonlyArray<Stored>): Stored => {
  const first = rows[0]

  if (first === undefined) throw unavailable()
  const qualifications = rows.flatMap((row) => row.qualifications ?? [])
  const places = qualifications.map(({ country, year }) => `${country}:${year}`)

  if (new Set(places).size !== places.length) throw unavailable()

  return {
    indicator: first.indicator,
    dataset: first.dataset,
    dimensions: first.dimensions,
    version: first.version,
    retrievedAt: first.retrievedAt,
    observations: rows.flatMap((row) => row.observations),
    qualifications,
  }
}
