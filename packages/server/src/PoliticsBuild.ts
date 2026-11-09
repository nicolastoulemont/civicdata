import { Publisher } from "@civicdata/domain"
import { Array as Arr, Context, Effect, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { SqlClient } from "effect/sql"

import { ArchiveUnavailable, Archives, Recorded } from "./Archives.ts"
import { database, Step } from "./CatalogBuild.ts"
import { politicsTables } from "./Politics.ts"

// Each insert binds one JSON array of governments, unpacked by SQLite's
// json_each. 500 governments is about 150 KB, under D1's 2 MB limit for one
// bound value.
const rowsPerInsert = 500

const RecordedJson = Schema.fromJsonString(Schema.toCodecJson(Schema.Array(Recorded)))

interface Interface {
  // Fetches the publisher's governments into the generation, replacing what
  // an earlier attempt wrote there, and answers how many it wrote. No
  // governments is the publisher failing, so it never replaces published ones.
  readonly write: (
    publisher: Publisher,
    generation: number,
  ) => Effect.Effect<number, ArchiveUnavailable>
  // Points reads at the generation, unless a newer one is already
  // published, and drops the publisher's older generations.
  readonly publish: (publisher: Publisher, generation: number) => Effect.Effect<void>
}

// A build that left some publishers on their previous generation.
export class PoliticsBuildFailed extends Schema.TaggedError<
  PoliticsBuildFailed,
  { readonly brand: unique symbol }
>()("PoliticsBuildFailed", {
  publishers: Schema.Array(Publisher),
}) {}

// Stores each publisher's governments in D1 for Politics to read, in the
// same Workflow as the indicator catalog (CatalogWorkflow.ts).
export class PoliticsBuild extends Context.Service<PoliticsBuild, Interface>()(
  "@civicdata/server/PoliticsBuild",
) {
  static readonly layer = Layer.effect(
    PoliticsBuild,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const archives = yield* Archives

      yield* politicsTables

      const write = Effect.fn("PoliticsBuild.write")(
        function* (publisher: Publisher, generation: number) {
          const governments = yield* archives.governments(publisher)

          if (!Arr.isReadonlyArrayNonEmpty(governments)) {
            return yield* new ArchiveUnavailable({ publisher, cause: "No governments" })
          }

          yield* sql`
            DELETE FROM governments WHERE publisher = ${publisher} AND generation = ${generation}
          `

          for (const chunk of Arr.chunksOf(governments, rowsPerInsert)) {
            const rows = yield* Schema.encodeEffect(RecordedJson)(chunk)

            yield* sql`
              INSERT INTO governments
                (publisher, generation, country, start, head, parties, until, url, retrieved_at)
              SELECT ${publisher}, ${generation}, json_extract(value, '$.country'),
                json_extract(value, '$.start'), json_extract(value, '$.head'),
                json_extract(value, '$.parties'), json_extract(value, '$.until'),
                json_extract(value, '$.url'), json_extract(value, '$.retrievedAt')
              FROM json_each(${rows})
            `
          }

          return governments.length
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      const publish = Effect.fn("PoliticsBuild.publish")(
        function* (publisher: Publisher, generation: number) {
          yield* sql`
            INSERT INTO politics_current (records, publisher, generation)
            VALUES ('governments', ${publisher}, ${generation})
            ON CONFLICT (records, publisher) DO UPDATE SET generation = excluded.generation
            WHERE excluded.generation > politics_current.generation
          `
          yield* sql`
            DELETE FROM governments WHERE publisher = ${publisher} AND generation < (
              SELECT generation FROM politics_current
              WHERE records = 'governments' AND publisher = ${publisher}
            )
          `
        },
        Effect.catchTag("SqlError", Effect.die),
      )

      return PoliticsBuild.of({ write, publish })
    }).pipe(Effect.orDie),
  )

  // Inside Workers, where the Workflow runs, with D1 and the Worker's fetch.
  static readonly live = PoliticsBuild.layer.pipe(
    Layer.provide(database),
    Layer.provide(Archives.layer),
    Layer.provide(FetchHttpClient.layer),
  )

  // One generation of every publisher's governments, numbered like the
  // catalog's by the build's start time. Publishers build side by side, so one
  // that stays down keeps its previous generation; the build then fails,
  // naming it.
  static readonly run = Effect.fn("PoliticsBuild.run")(function* (generation: number) {
    const step = yield* Step
    const build = yield* PoliticsBuild

    const one = Effect.fn("PoliticsBuild.publisher")(function* (publisher: Publisher) {
      yield* step.run(`write ${publisher} governments`, build.write(publisher, generation))
      yield* step.run(`publish ${publisher} governments`, build.publish(publisher, generation))
    })

    const [, failed] = yield* Effect.partition(
      Publisher.literals,
      (publisher) =>
        one(publisher).pipe(
          Effect.tapError((error) => Effect.logError("Politics build failed", publisher, error)),
          Effect.mapError(() => publisher),
        ),
      { concurrency: "unbounded" },
    )

    return yield* Arr.isArrayNonEmpty(failed)
      ? Effect.fail(new PoliticsBuildFailed({ publishers: failed }))
      : Effect.void
  })
}
