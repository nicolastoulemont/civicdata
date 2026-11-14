import { Schema } from "effect"

import { Digest } from "./archive.schemas.ts"
import { Version } from "./store.schemas.ts"

export const VersionId = Version.fields.id

// What a run is started with. Annotate annotates the listed versions' keys;
// `retry` lets it claim an Abandoned one again. Demand annotates the versions
// questions asked for, as the daily run does. Retire clears a listed
// version's active annotation when that annotation is under other settings.
export const Params = Schema.TaggedUnion({
  Annotate: {
    versions: Schema.NonEmptyArray(VersionId),
    retry: Schema.optionalKey(Schema.Boolean),
  },
  Demand: {},
  Retire: { versions: Schema.NonEmptyArray(VersionId) },
})

export type Params = typeof Params.Type

export const Stage = Schema.Literals(["Claim", "Load", "Scope", "Labels", "Publish"])

// What a run did with one listed version.
// - Annotated: its key is Ready, by this run or an earlier one.
// - Failed: a stage gave up. Invalid output, unavailable source text and a
//   provider that kept failing count as one of the key's attempts.
// - Skipped: the version's text changed, its key's settings are not the
//   current ones (Stale), it was withdrawn, another run holds its key
//   (Held), or its key is Abandoned. Not an attempt.
// - NotStarted: the run reached a cap before claiming its key.
export const Outcome = Schema.TaggedUnion({
  Annotated: { key: Digest },
  Failed: {
    stage: Stage,
    reason: Schema.Literals(["Invalid", "Unavailable", "Provider", "Store"]),
    problem: Schema.String,
  },
  Skipped: { reason: Schema.Literals(["Stale", "Withdrawn", "Held", "Abandoned"]) },
  NotStarted: {},
})

export type Outcome = typeof Outcome.Type

// A run's report on one listed version.
export const Report = Schema.Struct({ version: VersionId, outcome: Outcome })

export interface Report extends Schema.Schema.Type<typeof Report> {}
