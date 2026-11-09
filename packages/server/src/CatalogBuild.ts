import { CatalogEntry, Source, SourceUnavailable } from "@civicdata/domain"
import type { CloudflareWorkersModule } from "@cloudflare/workers-types"
import { D1Client } from "@effect/sql-d1"
import { Array as Arr, Context, Effect, Layer, Option, Order, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { tables } from "./Catalog.ts"
import { Sdmx } from "./Sdmx.ts"
import { Vectors, type VectorsUnavailable } from "./Vectors.ts"
import { WorldBank } from "./WorldBank.ts"

// D1 inside Workers, where the Workflow that builds the catalog and stores
// the political records runs. It has no use without the DB binding.
export const database = Layer.unwrap(
  Effect.promise(() => import("cloudflare:workers")).pipe(
    Effect.flatMap(({ env }) =>
      env.DB === undefined
        ? Effect.die("The Workflow needs the DB binding")
        : Effect.succeed(D1Client.layer({ db: env.DB }).pipe(Layer.orDie)),
    ),
  ),
)

// Each insert binds one JSON array of entries, unpacked by SQLite's json_each,
// so a write is a handful of round trips instead of one per 20 rows (D1 binds
// at most 100 parameters per statement). 250 entries is about 250 KB, well
// under D1's 2 MB limit for one bound value.
const rowsPerInsert = 250

// Entries embedded per step: Workers AI embeds at most 100 texts per call.
const embedPerStep = 100

const EntriesJson = Schema.fromJsonString(Schema.Array(CatalogEntry))

const Pending = Schema.Struct({ rowid: Schema.Int, ...CatalogEntry.fields })

// The SHA-256 of the text, in hex. A build stores one beside each generation
// it writes and skips a source or dataset whose fingerprint matches the
// published generation's.
export const fingerprint = (text: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ),
  )

// What a step hands back, which Workflows saves: a count, a cursor or
// nothing, never rows, so a saved result stays far below its 1 MiB limit.
type Saved = number | null | void

interface Interface {
  // Lists the source's indicators into the generation, replacing what an
  // earlier attempt wrote there, and answers how many it wrote. It writes
  // nothing and answers null when the published generation holds the same
  // entries, embedded by the same model. An empty list is the source failing,
  // so it never replaces a published one.
  readonly write: (
    source: Source,
    generation: number,
  ) => Effect.Effect<number | null, SourceUnavailable>
  // Embeds the generation's next entries after the row `after` into Vectors,
  // and answers the last row embedded, or null once every entry is in.
  readonly embed: (
    source: Source,
    { generation, after }: { generation: number; after: number },
  ) => Effect.Effect<number | null, VectorsUnavailable>
  // Points searches at the generation, unless a newer one is already
  // published, and drops the source's older generations.
  readonly publish: (source: Source, generation: number) => Effect.Effect<void>
}

// A step that still failed after its retries.
export class StepFailed extends Schema.TaggedError<StepFailed, { readonly brand: unique symbol }>()(
  "StepFailed",
  {
    step: Schema.String,
    cause: Schema.Defect(),
  },
) {}

// A build that left some sources on their previous generation.
export class BuildFailed extends Schema.TaggedError<
  BuildFailed,
  { readonly brand: unique symbol }
>()("BuildFailed", {
  sources: Schema.Array(Source),
}) {}

// Each step retries alone: about half an hour of retries outlasts the OECD's
// five-minute cooldown after it refuses the Workers' shared IP.
const retried = {
  retries: { limit: 5, delay: "1 minute", backoff: "exponential" },
  timeout: "5 minutes",
} satisfies CloudflareWorkersModule.WorkflowStepConfig

// Runs one named step of a build. Workflows saves the result of each step
// that completes; when a build resumes after a failure, a completed step
// answers its saved result instead of running again.
export class Step extends Context.Service<
  Step,
  {
    readonly run: <A extends Saved, E>(
      name: string,
      effect: Effect.Effect<A, E>,
    ) => Effect.Effect<A, StepFailed>
  }
>()("@civicdata/server/CatalogBuild/Step") {
  static readonly workflow = (step: CloudflareWorkersModule.WorkflowStep) =>
    Layer.succeed(
      Step,
      Step.of({
        run: (name, effect) =>
          Effect.tryPromise({
            try: () => step.do(name, retried, () => Effect.runPromise(effect)),
            catch: (cause) => new StepFailed({ step: name, cause }),
          }),
      }),
    )

  // Runs each step once, saving nothing: a build outside Workflows, such as
  // the eval's.
  static readonly immediate = Layer.succeed(
    Step,
    Step.of({
      run: (name, effect) =>
        effect.pipe(Effect.mapError((cause) => new StepFailed({ step: name, cause }))),
    }),
  )
}

// Builds a new generation of the catalog: writes, embeds and publishes the
// entries of every source, each in its own steps. Sources build side by side,
// so one that stays down keeps its previous generation without holding back
// the others; the build then fails, naming it.
export class CatalogBuild extends Context.Service<CatalogBuild, Interface>()(
  "@civicdata/server/CatalogBuild",
) {
  static readonly layer = Layer.effect(
    CatalogBuild,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const worldBank = yield* WorldBank
      const sdmx = yield* Sdmx
      const vectors = yield* Vectors

      yield* tables

      const pending = SqlSchema.findAll({
        Request: Schema.Struct({
          source: Source,
          generation: Schema.Int,
          after: Schema.Int,
        }),
        Result: Pending,
        execute: ({ source, generation, after }) => sql`
          SELECT rowid, indicator, name, definition FROM catalog
          WHERE rowid > ${after} AND source = ${source} AND generation = ${generation}
          ORDER BY rowid
          LIMIT ${embedPerStep}
        `,
      })

      // The fingerprint of the source's published generation, if a build
      // stored one.
      const published = SqlSchema.findOneOption({
        Request: Source,
        Result: Schema.Struct({ fingerprint: Schema.String }),
        execute: (source) => sql`
          SELECT fingerprint FROM catalog_fingerprint
          JOIN catalog_current USING (source, generation)
          WHERE source = ${source}
        `,
      })

      const list = (source: Source) =>
        source === "World Bank" ? worldBank.indicators : sdmx.indicators(source)

      const write = Effect.fn("CatalogBuild.write")(
        function* (source: Source, generation: number) {
          const entries = yield* list(source)

          if (!Arr.isReadonlyArrayNonEmpty(entries)) {
            return yield* new SourceUnavailable({ source })
          }

          // Sorted, since a source may list the same entries in another order.
          const listed = yield* Schema.encodeEffect(EntriesJson)(
            Arr.sortWith(entries, (entry) => entry.indicator, Order.String),
          )

          const print = yield* fingerprint(`${vectors.model}\n${listed}`)

          if (Option.exists(yield* published(source), (found) => found.fingerprint === print)) {
            return null
          }

          yield* sql`DELETE FROM catalog WHERE source = ${source} AND generation = ${generation}`

          for (const chunk of Arr.chunksOf(entries, rowsPerInsert)) {
            const rows = yield* Schema.encodeEffect(EntriesJson)(chunk)

            yield* sql`
              INSERT INTO catalog (source, generation, indicator, name, definition)
              SELECT ${source}, ${generation}, json_extract(value, '$.indicator'),
                json_extract(value, '$.name'), json_extract(value, '$.definition')
              FROM json_each(${rows})
            `
          }

          // Last, so a generation with a fingerprint holds every entry.
          yield* sql`
            INSERT INTO catalog_fingerprint (source, generation, fingerprint)
            VALUES (${source}, ${generation}, ${print})
            ON CONFLICT (source, generation) DO UPDATE SET fingerprint = excluded.fingerprint
          `

          return entries.length
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      const embed = Effect.fn("CatalogBuild.embed")(
        function* (source: Source, { generation, after }: { generation: number; after: number }) {
          const batch = yield* pending({ source, generation, after })

          if (!Arr.isReadonlyArrayNonEmpty(batch)) return null

          yield* vectors.put(batch)

          return Arr.lastNonEmpty(batch).rowid
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      const publish = Effect.fn("CatalogBuild.publish")(
        function* (source: Source, generation: number) {
          yield* sql`
            INSERT INTO catalog_current (source, generation) VALUES (${source}, ${generation})
            ON CONFLICT (source) DO UPDATE SET generation = excluded.generation
            WHERE excluded.generation > catalog_current.generation
          `
          yield* sql`
            DELETE FROM catalog WHERE source = ${source}
              AND generation < (SELECT generation FROM catalog_current WHERE source = ${source})
          `
          yield* sql`
            DELETE FROM catalog_fingerprint WHERE source = ${source}
              AND generation < (SELECT generation FROM catalog_current WHERE source = ${source})
          `
        },
        Effect.catchTag("SqlError", Effect.die),
      )

      return CatalogBuild.of({ write, embed, publish })
    }).pipe(Effect.orDie),
  )

  // Inside Workers, where the Workflow runs, with D1 and paced sources.
  static readonly live = CatalogBuild.layer.pipe(
    Layer.provide(database),
    Layer.provide(Vectors.live),
    Layer.provide(WorldBank.live),
    Layer.provide(Sdmx.live),
  )

  // One generation of every source, numbered by the build's start time, so
  // a resumed build writes the same generation and a later build a newer one.
  // A source whose published generation already holds its listing stops
  // after its write step. The step saves that decision, so a resumed build
  // makes the same one.
  static readonly run = Effect.fn("CatalogBuild.run")(function* (generation: number) {
    const step = yield* Step
    const build = yield* CatalogBuild

    const one = Effect.fn("CatalogBuild.source")(function* (source: Source) {
      const written = yield* step.run(`write ${source}`, build.write(source, generation))

      if (written === null) return source

      let after: number | null = 0

      while (after !== null) {
        after = yield* step.run(
          `embed ${source} after ${after}`,
          build.embed(source, { generation, after }),
        )
      }

      yield* step.run(`publish ${source}`, build.publish(source, generation))

      return source
    })

    const [, failed] = yield* Effect.partition(
      Source.literals,
      (source) =>
        one(source).pipe(
          Effect.tapError((error) => Effect.logError("Catalog build failed", source, error)),
          Effect.mapError(() => source),
        ),
      { concurrency: "unbounded" },
    )

    return yield* Arr.isArrayNonEmpty(failed)
      ? Effect.fail(new BuildFailed({ sources: failed }))
      : Effect.void
  })
}
