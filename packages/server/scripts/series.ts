import { execFile } from "node:child_process"
import { createReadStream } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { NodeStream } from "@effect/platform-node"
import { SourceUnavailable, type Source, sourceOf } from "@repo/domain"
import { Effect, Schema, Stream } from "effect"

import { Stored } from "../src/series/Store.schemas.ts"

export const scratch = (source: Source) =>
  Effect.acquireRelease(
    Effect.tryPromise(() => mkdtemp(join(tmpdir(), `${source.toLowerCase()}-`))),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  )

export const sortRows = (path: string, output: string) =>
  Effect.tryPromise(() =>
    promisify(execFile)("sort", ["-o", output, path], { env: { ...process.env, LC_ALL: "C" } }),
  )

// Both local archive readers stage row JSON with a sortable prefix. Only one
// complete series is retained at a time, then Store owns packing and ordering.
export const series = (
  path: string,
  metadata: Omit<Stored, "dimensions" | "observations" | "qualifications">,
) => {
  const unavailable = () => new SourceUnavailable({ source: sourceOf(metadata.indicator.id) })

  return jsonRows(path, sourceOf(metadata.indicator.id)).pipe(
    Stream.mapEffect((row) => Schema.decodeUnknownEffect(Stored)({ ...metadata, ...row })),
    Stream.groupAdjacentBy((row) => JSON.stringify(row.dimensions)),
    Stream.mapEffect(([, rows]) => Effect.try({ try: () => assemble(rows), catch: unavailable })),
    Stream.mapError(unavailable),
  )
}

const assemble = (rows: ReadonlyArray<Stored>): Stored => {
  const first = rows[0]

  if (first === undefined) throw new Error("Empty series")
  const qualifications = rows.flatMap((row) => row.qualifications ?? [])
  const places = qualifications.map(({ country, year }) => `${country}:${year}`)

  if (new Set(places).size !== places.length) throw new Error("Duplicate country-year")

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

// Disk staging and native extraction both write one JSON record per line.
export const jsonRows = (path: string, source: Source) =>
  NodeStream.fromReadable({
    evaluate: () => createReadStream(path),
    onError: () => new SourceUnavailable({ source }),
  }).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((line) => line !== ""),
    Stream.mapEffect((line) =>
      Schema.decodeUnknownEffect(
        Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
      )(line.slice(line.indexOf("\t") + 1)),
    ),
    Stream.mapError(() => new SourceUnavailable({ source })),
  )
