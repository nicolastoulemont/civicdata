import { createHash } from "node:crypto"

import { Vote } from "@civicdata/domain"
import { Schema } from "effect"

export const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)).pipe(
  Schema.brand("EvalDigest"),
)

// Every archive path is relative. Restrict components before touching disk or R2.
export const Path = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*)*$/),
).pipe(Schema.brand("EvalPath"))

export type Digest = typeof Digest.Type

export const File = Schema.Struct({
  path: Path,
  digest: Digest,
  bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})

const Answer = Schema.Struct({ path: Path, digest: Digest })

const Review = Schema.Struct({
  votes: Digest,
  answers: Schema.Array(Path),
  // Historical reviewer identity was not stored by the harness.
  reviewer: Schema.NullOr(Schema.String),
  report: Schema.NullOr(Digest),
})

export const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  label: Schema.NonEmptyString,
  capturedAt: Schema.DateTimeUtcFromString,
  // A run-start snapshot, or null for imports whose original state is unknown.
  origin: Schema.NullOr(Digest),
  files: Schema.Array(File),
  answers: Schema.Array(Answer),
  reviews: Schema.Array(Review),
  // Archive-time snapshots, not a claim about the historical run's exact inputs.
  snapshot: Schema.Struct({ probes: Digest, rubric: Digest, recordings: Digest }),
})

export const ManifestJson = Schema.fromJsonString(Manifest)

export const VotesJson = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      answer: Digest,
      turn: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      vote: Vote,
    }),
  ),
)

export class ArchiveError extends Schema.TaggedError<
  ArchiveError,
  { readonly brand: unique symbol }
>()("ArchiveError", {
  operation: Schema.String,
  detail: Schema.String,
}) {}

export const digest = (bytes: Uint8Array) =>
  Digest.make(createHash("sha256").update(bytes).digest("hex"))

export const bytesOf = (text: string) => new TextEncoder().encode(text)
export const textOf = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes)

export const json = (value: Schema.Json) => bytesOf(`${JSON.stringify(value, null, 2)}\n`)
