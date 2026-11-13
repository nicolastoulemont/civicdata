import { Schema } from "effect"

import pinned from "./archive.json" with { type: "json" }

const path = Schema.String.check(
  Schema.isPattern(/^(sources\/[a-z0-9-]+\.json(?:\.gz)?|downloads\/[A-Z]{3}\.zip)$/),
).pipe(Schema.brand("MapArtifactPath"))

export const Artifact = Schema.Struct({
  path,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  bytes: Schema.Int.check(Schema.isGreaterThan(0)),
})

export interface Artifact extends Schema.Schema.Type<typeof Artifact> {}

export const Archive = Schema.Struct({
  origin: Schema.String.check(Schema.isPattern(/^https:\/\/[a-z0-9.-]+$/)),
  files: Schema.Array(Artifact),
})

interface Archive extends Schema.Schema.Type<typeof Archive> {}

const archive: Archive = Schema.decodeSync(Archive)(pinned)

export const artifacts = archive.files

export const url = (artifact: Artifact) =>
  `${archive.origin}/sha256/${artifact.sha256}/${artifact.path}?download=1`
