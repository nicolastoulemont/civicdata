import { basename, dirname, join } from "node:path"
import { gzipSync } from "node:zlib"

import { DateTime, Effect, FileSystem, Schema } from "effect"

import { isProbeFile, ProbedJson } from "../../eval/probes.ts"
import {
  ArchiveError,
  bytesOf,
  digest,
  type Digest,
  File,
  json,
  Manifest,
  ManifestJson,
  Path,
  textOf,
} from "./model.ts"

type File = typeof File.Type

type Manifest = typeof Manifest.Type

const walk = Effect.fn("Evals.walk")(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem
  const paths: Array<string> = []
  const directories = [""]

  while (directories.length > 0) {
    const directory = directories.pop()

    if (directory === undefined) break

    for (const entry of yield* fs.readDirectoryEntries(join(folder, directory))) {
      const path = directory === "" ? entry.name : `${directory}/${entry.name}`

      if (entry.type === "Directory") directories.push(path)
      else if (entry.type === "File") paths.push(path)
      else
        return yield* new ArchiveError({ operation: "pack", detail: `Not a regular file: ${path}` })
    }
  }

  return paths.toSorted()
})

interface PackOptions {
  readonly out: string
  readonly label?: string | undefined
  readonly reviewer?: string | undefined
  readonly server: string
}

const votesOf = (probed: typeof ProbedJson.Type, answer: Digest) =>
  probed.rows.flatMap((row, turn) => (row.vote === null ? [] : [{ answer, turn, vote: row.vote }]))

// A pack is a new immutable revision. Working files are retained byte-for-byte;
// canonical answers exclude votes, which live in their own review artifact.
export const pack = Effect.fn("Evals.pack")(function* (folder: string, options: PackOptions) {
  const fs = yield* FileSystem.FileSystem
  const blobs = new Map<string, Uint8Array>()

  const keep = (body: Uint8Array) => {
    const hash = digest(body)
    blobs.set(hash, body)

    return hash
  }

  const files: Array<File> = []
  const answers: Array<Manifest["answers"][number]> = []

  const reviews = new Map<
    string,
    {
      paths: Array<typeof Path.Type>
      votes: Array<{ answer: string; turn: number; vote: Schema.Json }>
    }
  >()

  for (const path of yield* walk(folder)) {
    const safe = yield* Schema.decodeEffect(Path)(path)
    const body = yield* fs.readFile(join(folder, path))
    files.push({ path: safe, digest: keep(body), bytes: body.length })

    if (!isProbeFile(basename(path))) continue

    const probed = yield* Schema.decodeEffect(ProbedJson)(textOf(body))
    const clean = { ...probed, rows: probed.rows.map((row) => ({ ...row, vote: null })) }
    const hash = keep(bytesOf(yield* Schema.encodeEffect(ProbedJson)(clean)))
    answers.push({ path: safe, digest: hash })

    // A batch can contain several runs. Preserve their reviews independently;
    // superseded attempts remain evidence, not extra scored answers.
    if (path.startsWith("attempts/") || path.includes("/attempts/")) continue

    const scope = dirname(path)
    const review = reviews.get(scope) ?? { paths: [], votes: [] }

    const votes = votesOf(probed, hash)

    if (votes.length > 0) {
      review.paths.push(safe)
      review.votes.push(...votes)
    }

    reviews.set(scope, review)
  }

  if (answers.length === 0) {
    return yield* new ArchiveError({ operation: "pack", detail: "No probe answers found" })
  }

  const recordings = yield* Effect.forEach(
    yield* walk(join(options.server, "eval/recordings")),
    Effect.fn("Evals.recording")(function* (path) {
      const body = yield* fs.readFile(join(options.server, "eval/recordings", path))

      return { path, digest: digest(body), body: Buffer.from(body).toString("base64") }
    }),
  )

  const origin = files.find((file) => file.path === "context.json")

  const manifest: Manifest = {
    version: 1,
    label: options.label ?? basename(folder),
    capturedAt: yield* DateTime.now,
    origin: origin?.digest ?? null,
    files,
    answers,
    reviews: [...reviews].flatMap(([scope, review]) =>
      review.votes.length === 0
        ? []
        : [
            {
              votes: keep(json(review.votes)),
              answers: review.paths,
              reviewer: options.reviewer ?? null,
              report: files.find((file) => file.path === join(scope, "review.md"))?.digest ?? null,
            },
          ],
    ),
    snapshot: {
      probes: keep(yield* fs.readFile(join(options.server, "eval/probes.ts"))),
      rubric: keep(yield* fs.readFile(join(options.server, "eval/probes.md"))),
      recordings: keep(gzipSync(json(recordings))),
    },
  }

  const body = bytesOf(yield* Schema.encodeEffect(ManifestJson)(manifest))
  const id = digest(body)
  yield* fs.makeDirectory(dirname(options.out), { recursive: true })
  yield* fs.makeDirectory(options.out)
  yield* fs.makeDirectory(join(options.out, "objects"))

  for (const [hash, contents] of blobs) {
    yield* fs.writeFile(join(options.out, "objects", hash), contents, { flag: "wx" })
  }

  yield* fs.writeFile(join(options.out, "manifest.json"), body, { flag: "wx" })

  return { id, manifest }
})
