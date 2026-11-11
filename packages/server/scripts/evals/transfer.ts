import { dirname, join } from "node:path"

import { Context, Effect, FileSystem, Option, Schema } from "effect"

import { ProbedJson } from "../../eval/probes.ts"
import {
  ArchiveError,
  bytesOf,
  Digest,
  digest,
  Manifest,
  ManifestJson,
  textOf,
  VotesJson,
} from "./model.ts"

type Manifest = typeof Manifest.Type

interface Interface {
  readonly get: (key: string) => Effect.Effect<Option.Option<Uint8Array>, ArchiveError>
  readonly put: (key: string, body: Uint8Array) => Effect.Effect<void, ArchiveError>
  readonly list: (prefix: string) => Effect.Effect<ReadonlyArray<string>, ArchiveError>
}

export class Store extends Context.Service<Store, Interface>()("Evals/Store") {}

const prefix = "evals/v1"
const objectKey = (hash: Digest) => `${prefix}/objects/${hash}`
const manifestKey = (id: Digest) => `${prefix}/runs/${id}.json`

const decodeManifest = Effect.fn("Evals.decodeManifest")(function* (body: Uint8Array, id: Digest) {
  if (digest(body) !== id) {
    return yield* new ArchiveError({
      operation: "verify",
      detail: `Manifest checksum differs: ${id}`,
    })
  }

  const manifest = yield* Schema.decodeEffect(ManifestJson)(textOf(body))

  if (new Set(manifest.files.map((file) => file.path)).size !== manifest.files.length) {
    return yield* new ArchiveError({ operation: "verify", detail: "Duplicate archive paths" })
  }

  return manifest
})

const hashes = (manifest: Manifest) =>
  new Set([
    ...manifest.files.map((file) => file.digest),
    ...manifest.answers.map((answer) => answer.digest),
    ...manifest.reviews.flatMap((review) =>
      review.report === null ? [review.votes] : [review.votes, review.report],
    ),
    ...Object.values(manifest.snapshot),
    ...(manifest.origin === null ? [] : [manifest.origin]),
  ])

const checked = Effect.fn("Evals.checked")(function* (
  hash: Digest,
  body: Option.Option<Uint8Array>,
) {
  if (Option.isNone(body) || digest(body.value) !== hash) {
    return yield* new ArchiveError({
      operation: "verify",
      detail: `Missing or corrupt object: ${hash}`,
    })
  }

  return body.value
})

const verifySizes = Effect.fn("Evals.verifySizes")(function* (
  manifest: Manifest,
  objects: ReadonlyMap<Digest, Uint8Array>,
) {
  for (const file of manifest.files) {
    if (objects.get(file.digest)?.length !== file.bytes) {
      return yield* new ArchiveError({ operation: "verify", detail: `Size differs: ${file.path}` })
    }
  }

  return undefined
})

const validate = Effect.fn("Evals.validate")(function* (
  manifest: Manifest,
  objects: ReadonlyMap<Digest, Uint8Array>,
) {
  yield* verifySizes(manifest, objects)

  const rows = new Map<Digest, number>()

  for (const answer of manifest.answers) {
    const body = yield* checked(answer.digest, Option.fromUndefinedOr(objects.get(answer.digest)))
    const probed = yield* Schema.decodeEffect(ProbedJson)(textOf(body))

    if (probed.rows.some((row) => row.vote !== null)) {
      return yield* new ArchiveError({
        operation: "verify",
        detail: "Canonical answers must exclude votes",
      })
    }

    rows.set(answer.digest, probed.rows.length)
  }

  for (const review of manifest.reviews) {
    const body = yield* checked(review.votes, Option.fromUndefinedOr(objects.get(review.votes)))
    const votes = yield* Schema.decodeEffect(VotesJson)(textOf(body))

    for (const vote of votes) {
      const count = rows.get(vote.answer)

      if (count === undefined || vote.turn >= count) {
        return yield* new ArchiveError({
          operation: "verify",
          detail: "Review refers to an absent answer or turn",
        })
      }
    }
  }

  return undefined
})

const put = Effect.fn("Evals.put")(function* (key: string, body: Uint8Array) {
  const store = yield* Store
  const existing = yield* store.get(key)

  if (Option.isSome(existing)) {
    if (digest(existing.value) !== digest(body)) {
      return yield* new ArchiveError({
        operation: "push",
        detail: `Conflicting immutable object: ${key}`,
      })
    }
  } else yield* store.put(key, body)
  yield* checked(digest(body), yield* store.get(key))

  return undefined
})

export const push = Effect.fn("Evals.push")(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem
  const body = yield* fs.readFile(join(folder, "manifest.json"))
  const id = digest(body)
  const manifest = yield* decodeManifest(body, id)

  // Validate every local object before sending anything.
  const objects = yield* Effect.forEach(
    [...hashes(manifest)],
    Effect.fn("Evals.localObject")(function* (hash) {
      return {
        hash,
        body: yield* checked(hash, Option.some(yield* fs.readFile(join(folder, "objects", hash)))),
      }
    }),
  )

  yield* validate(manifest, new Map(objects.map(({ hash, body: contents }) => [hash, contents])))

  yield* Effect.forEach(objects, ({ hash, body: contents }) => put(objectKey(hash), contents), {
    concurrency: 6,
  })
  // Only complete uploads are discoverable. Content-addressed keys make retries safe.
  yield* put(manifestKey(id), body)

  return id
})

export const list = Effect.fn("Evals.list")(function* () {
  const store = yield* Store
  const keys = yield* store.list(`${prefix}/runs/`)

  return yield* Effect.forEach(
    keys,
    Effect.fn("Evals.listed")(function* (key) {
      const id = yield* Schema.decodeEffect(Digest)(key.slice(`${prefix}/runs/`.length, -5))
      const body = yield* checked(id, yield* store.get(key))

      return { id, manifest: yield* decodeManifest(body, id) }
    }),
  )
})

export const pull = Effect.fn("Evals.pull")(function* (id: Digest, folder: string) {
  const fs = yield* FileSystem.FileSystem

  if (yield* fs.exists(folder)) {
    return yield* new ArchiveError({
      operation: "pull",
      detail: `Destination already exists: ${folder}`,
    })
  }

  const store = yield* Store
  const body = yield* checked(id, yield* store.get(manifestKey(id)))
  const manifest = yield* decodeManifest(body, id)
  const objects = new Map<Digest, Uint8Array>()
  yield* Effect.forEach(
    [...hashes(manifest)],
    Effect.fn("Evals.remoteObject")(function* (hash) {
      objects.set(hash, yield* checked(hash, yield* store.get(objectKey(hash))))
    }),
    { concurrency: 6 },
  )
  yield* validate(manifest, objects)

  // No local writes until all objects validate. mkdir refuses an existing target.
  yield* fs.makeDirectory(dirname(folder), { recursive: true })
  yield* fs.makeDirectory(folder)
  yield* fs.makeDirectory(join(folder, "objects"))

  for (const [hash, contents] of objects) {
    yield* fs.writeFile(join(folder, "objects", hash), contents, { flag: "wx" })
  }

  yield* fs.writeFile(join(folder, "manifest.json"), body, { flag: "wx" })
  yield* fs.makeDirectory(join(folder, "run"))

  for (const file of manifest.files) {
    const contents = yield* Effect.fromOption(Option.fromUndefinedOr(objects.get(file.digest)))
    const parts = file.path.split("/")
    parts.pop()
    yield* fs.makeDirectory(join(folder, "run", ...parts), { recursive: true })
    yield* fs.writeFile(join(folder, "run", file.path), contents, { flag: "wx" })
  }

  // This marker is written last; a disk failure leaves an explicitly incomplete restore.
  yield* fs.writeFile(join(folder, "complete"), bytesOf(`${id}\n`), { flag: "wx" })

  return manifest
})
