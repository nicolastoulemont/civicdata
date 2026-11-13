import { type Source, SourceUnavailable } from "@repo/domain"
import { DateTime, Effect, Result, Schema } from "effect"
import { SqlClient } from "effect/sql"

import { type AssetId } from "../series/Adapter.schemas.ts"
import { ledger } from "../series/GatherLedger.ts"
import { reasonOf } from "../series/utils/reasonOf.ts"

interface Input {
  readonly asset: AssetId
  readonly version: string
  readonly fetch: Effect.Effect<unknown, SourceUnavailable>
}

// Persist selected normalized fragments, never source archives. Each input has
// its own version and ledger entry; a failed sibling or assembly keeps it reusable.
export const collect = Effect.fn("Inputs.collect")(
  function* (source: Source, inputs: ReadonlyArray<Input>) {
    if (
      inputs.length === 0 ||
      inputs.length > 50 ||
      new Set(inputs.map(({ asset }) => asset)).size !== inputs.length
    )
      return yield* new SourceUnavailable({ source })
    const sql = yield* SqlClient.SqlClient
    const progress = yield* ledger("/inputs/v1")
    yield* sql`CREATE TABLE IF NOT EXISTS source_input (
    source TEXT NOT NULL, asset TEXT NOT NULL, version TEXT NOT NULL,
    fragment TEXT NOT NULL CHECK(json_valid(fragment)),
    PRIMARY KEY(source, asset, version)
  )`
    const now = DateTime.formatIso(yield* DateTime.now)
    const versions = inputs.map(({ asset, version }) => ({ asset, version }))
    const wanted = yield* progress.work({ source, versions, after: "", now })

    for (const item of wanted) {
      const input = inputs.find(({ asset }) => asset === item.asset)

      if (input === undefined) return yield* new SourceUnavailable({ source })

      const attempt = yield* Effect.gen(function* () {
        const saved = yield* sql<{
          fragment: string
        }>`SELECT fragment FROM source_input WHERE source = ${source} AND asset = ${input.asset} AND version = ${input.version}`

        if (saved.length > 0) {
          yield* progress.stored(input.asset, { source, version: input.version })

          return undefined
        }

        const value = yield* input.fetch
        const fragment = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(value)
        yield* sql`INSERT OR IGNORE INTO source_input (source, asset, version, fragment)
        VALUES (${source}, ${input.asset}, ${input.version}, ${fragment})`

        const rows = yield* sql<{ fragment: string }>`SELECT fragment FROM source_input
        WHERE source = ${source} AND asset = ${input.asset} AND version = ${input.version}`

        if (rows[0]?.fragment !== fragment) return yield* new SourceUnavailable({ source })
        yield* progress.stored(input.asset, { source, version: input.version })

        return undefined
      }).pipe(Effect.result)

      if (Result.isFailure(attempt))
        yield* progress.failed(input.asset, {
          source,
          version: input.version,
          previous: item.state,
          reason: reasonOf(attempt.failure),
        })
    }

    const done = yield* progress.summary({ source, versions, now })

    if (done.unchanged !== inputs.length) return yield* new SourceUnavailable({ source })

    return yield* Effect.forEach(inputs, (input) =>
      Effect.gen(function* () {
        const rows = yield* sql<{ fragment: string }>`SELECT fragment FROM source_input
      WHERE source = ${source} AND asset = ${input.asset} AND version = ${input.version}`

        return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(
          rows[0]?.fragment,
        )
      }),
    )
  },
  (effect, source) => effect.pipe(Effect.mapError(() => new SourceUnavailable({ source }))),
)
