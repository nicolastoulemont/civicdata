import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { open } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { SourceUnavailable } from "@openfacts/domain"
import { Config, DateTime, Effect, Layer, Schema, Stream } from "effect"
import { HttpClient } from "effect/http"

import { polyarchy, VdemArchive } from "../src/Vdem.ts"
import { jsonRows, scratch, series, sortRows } from "./series.ts"

const unavailable = () => new SourceUnavailable({ source: "V-Dem" })

// Native R parsing runs only in this explicit Node ingestion path.
export const vdemArchive = Layer.effect(
  VdemArchive,
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
    const python = yield* Config.String("VDEM_PYTHON")

    return VdemArchive.of({
      read: Stream.unwrap(
        Effect.gen(function* () {
          const folder = yield* scratch("V-Dem")
          const archive = join(folder, "vdem.RData")
          const rows = join(folder, "rows.jsonl")
          const staged = join(folder, "staged")
          const sorted = join(folder, "sorted")
          const response = yield* client.get(polyarchy.archiveUrl)
          const retrievedAt = yield* DateTime.now
          const hash = createHash("sha256")
          const download = yield* Effect.tryPromise(() => open(archive, "w"))
          yield* response.stream.pipe(
            Stream.runForEach((chunk) =>
              Effect.tryPromise(() => {
                hash.update(chunk)

                return download.write(chunk)
              }),
            ),
            Effect.ensuring(Effect.promise(() => download.close())),
          )

          if (hash.digest("hex") !== polyarchy.sha256) return yield* unavailable()
          yield* Effect.tryPromise(() =>
            promisify(execFile)(python, [
              fileURLToPath(new URL("./vdem-extract.py", import.meta.url)),
              archive,
              rows,
            ]),
          )
          const output = yield* Effect.tryPromise(() => open(staged, "w"))
          let count = 0
          yield* jsonRows(rows, "V-Dem").pipe(
            Stream.mapEffect((row) => Schema.decodeUnknownEffect(polyarchy.row)(row)),
            Stream.mapEffect(polyarchy.record),
            Stream.runForEach((row) => {
              if (row === undefined) return Effect.void
              const place = row.qualifications[0]

              if (place === undefined) return Effect.fail(unavailable())
              count += 1

              return Effect.tryPromise(() =>
                output.write(`${place.country}:${place.year}\t${JSON.stringify(row)}\n`),
              ).pipe(Effect.asVoid, Effect.mapError(unavailable))
            }),
            Effect.ensuring(Effect.promise(() => output.close())),
          )

          // The pinned reviewed selection contains exactly 35 years for each country.
          if (count !== 70) return yield* unavailable()
          yield* sortRows(staged, sorted)

          return series(sorted, {
            indicator: {
              id: polyarchy.indicator,
              name: polyarchy.name,
              definition: polyarchy.definition,
            },
            dataset: polyarchy.dataset,
            version: polyarchy.version,
            retrievedAt,
          })
        }).pipe(Effect.mapError(unavailable)),
      ),
    })
  }),
)
