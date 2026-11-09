import { Publisher } from "@civicdata/domain"
import { Array as Arr, Context, Effect, Layer, Match, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { SqlClient } from "effect/sql"

import { ArchiveUnavailable, Archives, ElectionRecord, GovernmentRecord } from "./Archives.ts"
import { database, Step } from "./CatalogBuild.ts"
import { politicsTables, Records } from "./Politics.ts"

// Each insert binds one JSON array of records, unpacked by SQLite's
// json_each. 500 governments is about 150 KB, under D1's 2 MB limit for one
// bound value; an election is smaller.
const rowsPerInsert = 500

const GovernmentsJson = Schema.fromJsonString(Schema.toCodecJson(Schema.Array(GovernmentRecord)))

const ElectionsJson = Schema.fromJsonString(Schema.toCodecJson(Schema.Array(ElectionRecord)))

// One publisher's records of one kind, stored and published together.
const Dataset = Schema.Struct({ records: Records, publisher: Publisher })

type Dataset = typeof Dataset.Type

const datasets: ReadonlyArray<Dataset> = Records.literals.flatMap((records) =>
  Publisher.literals.map((publisher) => ({ records, publisher })),
)

interface Interface {
  // Fetches the dataset into the generation, replacing what an earlier
  // attempt wrote there, and answers how many records it wrote. No records
  // is the publisher failing, so it never replaces published ones.
  readonly write: (
    dataset: Dataset,
    generation: number,
  ) => Effect.Effect<number, ArchiveUnavailable>
  // Points reads at the generation, unless a newer one is already
  // published, and drops the dataset's older generations.
  readonly publish: (dataset: Dataset, generation: number) => Effect.Effect<void>
}

// A build that left some datasets on their previous generation.
export class PoliticsBuildFailed extends Schema.TaggedError<
  PoliticsBuildFailed,
  { readonly brand: unique symbol }
>()("PoliticsBuildFailed", {
  datasets: Schema.Array(Dataset),
}) {}

// Stores each publisher's governments and elections in D1 for Politics to
// read, in the same Workflow as the indicator catalog (CatalogWorkflow.ts).
export class PoliticsBuild extends Context.Service<PoliticsBuild, Interface>()(
  "@civicdata/server/PoliticsBuild",
) {
  static readonly layer = Layer.effect(
    PoliticsBuild,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const archives = yield* Archives

      yield* politicsTables

      const governments = Effect.fn("PoliticsBuild.governments")(function* (
        publisher: Publisher,
        generation: number,
      ) {
        const found = yield* archives.governments(publisher)

        for (const chunk of Arr.chunksOf(found, rowsPerInsert)) {
          const rows = yield* Schema.encodeEffect(GovernmentsJson)(chunk)

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

        return found.length
      })

      const elections = Effect.fn("PoliticsBuild.elections")(function* (
        publisher: Publisher,
        generation: number,
      ) {
        const found = yield* archives.elections(publisher)

        for (const chunk of Arr.chunksOf(found, rowsPerInsert)) {
          const rows = yield* Schema.encodeEffect(ElectionsJson)(chunk)

          yield* sql`
            INSERT INTO elections
              (publisher, generation, country, ballot, date, last_round, url, retrieved_at)
            SELECT ${publisher}, ${generation}, json_extract(value, '$.country'),
              json_extract(value, '$.ballot'), json_extract(value, '$.date'),
              json_extract(value, '$.lastRound'), json_extract(value, '$.url'),
              json_extract(value, '$.retrievedAt')
            FROM json_each(${rows})
          `
        }

        return found.length
      })

      const write = Effect.fn("PoliticsBuild.write")(
        function* ({ records, publisher }: Dataset, generation: number) {
          yield* sql`
            DELETE FROM ${sql(records)}
            WHERE publisher = ${publisher} AND generation = ${generation}
          `

          const written = yield* Match.value(records).pipe(
            Match.when("governments", () => governments(publisher, generation)),
            Match.when("elections", () => elections(publisher, generation)),
            Match.exhaustive,
          )

          return written === 0
            ? yield* new ArchiveUnavailable({ publisher, cause: `No ${records}` })
            : written
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      const publish = Effect.fn("PoliticsBuild.publish")(
        function* ({ records, publisher }: Dataset, generation: number) {
          yield* sql`
            INSERT INTO politics_current (records, publisher, generation)
            VALUES (${records}, ${publisher}, ${generation})
            ON CONFLICT (records, publisher) DO UPDATE SET generation = excluded.generation
            WHERE excluded.generation > politics_current.generation
          `
          yield* sql`
            DELETE FROM ${sql(records)} WHERE publisher = ${publisher} AND generation < (
              SELECT generation FROM politics_current
              WHERE records = ${records} AND publisher = ${publisher}
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

  // One generation of every dataset, numbered like the catalog's by the
  // build's start time. Datasets build side by side, so one whose publisher
  // stays down keeps its previous generation; the build then fails, naming it.
  static readonly run = Effect.fn("PoliticsBuild.run")(function* (generation: number) {
    const step = yield* Step
    const build = yield* PoliticsBuild

    const one = Effect.fn("PoliticsBuild.dataset")(function* (dataset: Dataset) {
      const name = `${dataset.publisher} ${dataset.records}`

      yield* step.run(`write ${name}`, build.write(dataset, generation))
      yield* step.run(`publish ${name}`, build.publish(dataset, generation))
    })

    const [, failed] = yield* Effect.partition(
      datasets,
      (dataset) =>
        one(dataset).pipe(
          Effect.tapError((error) => Effect.logError("Politics build failed", dataset, error)),
          Effect.mapError(() => dataset),
        ),
      { concurrency: "unbounded" },
    )

    return yield* Arr.isArrayNonEmpty(failed)
      ? Effect.fail(new PoliticsBuildFailed({ datasets: failed }))
      : Effect.void
  })
}
