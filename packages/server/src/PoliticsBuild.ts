import { Publisher } from "@civicdata/domain"
import { Array as Arr, Context, Effect, Layer, Match, Option, Schema, Struct } from "effect"
import { FetchHttpClient } from "effect/http"
import { SqlClient, SqlSchema } from "effect/sql"

import { ArchiveUnavailable, Archives, ElectionRecord, GovernmentRecord } from "./Archives.ts"
import { database } from "./CatalogBuild.ts"
import { fingerprint } from "./fingerprint.ts"
import { politicsTables, Records } from "./Politics.ts"
import { Step } from "./Step.ts"

// Each insert binds one JSON array of records, unpacked by SQLite's
// json_each. 500 governments is about 150 KB, under D1's 2 MB limit for one
// bound value; an election is smaller.
const rowsPerInsert = 500

const GovernmentsJson = Schema.fromJsonString(Schema.toCodecJson(Schema.Array(GovernmentRecord)))

const ElectionsJson = Schema.fromJsonString(Schema.toCodecJson(Schema.Array(ElectionRecord)))

// What a fingerprint hashes: the records without the time they were fetched,
// which differs on every build even when the records do not.
const GovernmentsPrint = Schema.fromJsonString(
  Schema.Array(GovernmentRecord.mapFields(Struct.omit(["retrievedAt"]))),
)

const ElectionsPrint = Schema.fromJsonString(
  Schema.Array(ElectionRecord.mapFields(Struct.omit(["retrievedAt"]))),
)

// One publisher's records of one kind, stored and published together.
const Dataset = Schema.Struct({ records: Records, publisher: Publisher })

type Dataset = typeof Dataset.Type

const datasets: ReadonlyArray<Dataset> = Records.literals.flatMap((records) =>
  Publisher.literals.map((publisher) => ({ records, publisher })),
)

interface Interface {
  // Fetches the dataset into the generation, replacing what an earlier
  // attempt wrote there, and answers how many records it wrote. It writes
  // nothing and answers null when the published generation holds the same
  // records. No records is the publisher failing, so it never replaces
  // published ones.
  readonly write: (
    dataset: Dataset,
    generation: number,
  ) => Effect.Effect<number | null, ArchiveUnavailable>
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

      // The fingerprint of the dataset's published generation, if a build
      // stored one.
      const published = SqlSchema.findOneOption({
        Request: Dataset,
        Result: Schema.Struct({ fingerprint: Schema.String }),
        execute: ({ records, publisher }) => sql`
          SELECT fingerprint FROM politics_fingerprint
          JOIN politics_current USING (records, publisher, generation)
          WHERE records = ${records} AND publisher = ${publisher}
        `,
      })

      // A publisher's governments: how many, the text their fingerprint
      // hashes, and the inserts that store them in the generation.
      const governments = Effect.fn("PoliticsBuild.governments")(function* (
        publisher: Publisher,
        generation: number,
      ) {
        const found = yield* archives.governments(publisher)

        return {
          count: found.length,
          text: yield* Schema.encodeEffect(GovernmentsPrint)(found),
          insert: Effect.forEach(
            Arr.chunksOf(found, rowsPerInsert),
            (chunk) =>
              Schema.encodeEffect(GovernmentsJson)(chunk).pipe(
                Effect.flatMap(
                  (rows) => sql`
                    INSERT INTO governments
                      (publisher, generation, country, start, head, parties, until, url, retrieved_at)
                    SELECT ${publisher}, ${generation}, json_extract(value, '$.country'),
                      json_extract(value, '$.start'), json_extract(value, '$.head'),
                      json_extract(value, '$.parties'), json_extract(value, '$.until'),
                      json_extract(value, '$.url'), json_extract(value, '$.retrievedAt')
                    FROM json_each(${rows})
                  `,
                ),
              ),
            { discard: true },
          ),
        }
      })

      // A publisher's elections, as `governments` answers its governments.
      const elections = Effect.fn("PoliticsBuild.elections")(function* (
        publisher: Publisher,
        generation: number,
      ) {
        const found = yield* archives.elections(publisher)

        return {
          count: found.length,
          text: yield* Schema.encodeEffect(ElectionsPrint)(found),
          insert: Effect.forEach(
            Arr.chunksOf(found, rowsPerInsert),
            (chunk) =>
              Schema.encodeEffect(ElectionsJson)(chunk).pipe(
                Effect.flatMap(
                  (rows) => sql`
                    INSERT INTO elections
                      (publisher, generation, country, ballot, date, last_round, url, retrieved_at)
                    SELECT ${publisher}, ${generation}, json_extract(value, '$.country'),
                      json_extract(value, '$.ballot'), json_extract(value, '$.date'),
                      json_extract(value, '$.lastRound'), json_extract(value, '$.url'),
                      json_extract(value, '$.retrievedAt')
                    FROM json_each(${rows})
                  `,
                ),
              ),
            { discard: true },
          ),
        }
      })

      const write = Effect.fn("PoliticsBuild.write")(
        function* (dataset: Dataset, generation: number) {
          const { records, publisher } = dataset

          const { count, text, insert } = yield* Match.value(records).pipe(
            Match.when("governments", () => governments(publisher, generation)),
            Match.when("elections", () => elections(publisher, generation)),
            Match.exhaustive,
          )

          if (count === 0) {
            return yield* new ArchiveUnavailable({ publisher, cause: `No ${records}` })
          }

          const print = yield* fingerprint(text)

          if (Option.exists(yield* published(dataset), (found) => found.fingerprint === print)) {
            return null
          }

          yield* sql`
            DELETE FROM ${sql(records)}
            WHERE publisher = ${publisher} AND generation = ${generation}
          `
          yield* insert
          // Last, so a generation with a fingerprint holds every record.
          yield* sql`
            INSERT INTO politics_fingerprint (records, publisher, generation, fingerprint)
            VALUES (${records}, ${publisher}, ${generation}, ${print})
            ON CONFLICT (records, publisher, generation)
            DO UPDATE SET fingerprint = excluded.fingerprint
          `

          return count
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
          yield* sql`
            DELETE FROM politics_fingerprint
            WHERE records = ${records} AND publisher = ${publisher} AND generation < (
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
  // A dataset whose published generation already holds its records stops
  // after its write step, which saves that decision for a resumed build.
  static readonly run = Effect.fn("PoliticsBuild.run")(function* (generation: number) {
    const step = yield* Step
    const build = yield* PoliticsBuild

    const one = Effect.fn("PoliticsBuild.dataset")(function* (dataset: Dataset) {
      const name = `${dataset.publisher} ${dataset.records}`

      const written = yield* step.run(`write ${name}`, build.write(dataset, generation))

      if (written === null) return

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
