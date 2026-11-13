// The ambient declaration must reach every program that compiles this file,
// including apps/web; a .d.ts cannot be imported.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="../cloudflare.d.ts" />

import { D1Client } from "@effect/sql-d1"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { once } from "../built.ts"
import { Version } from "./store.ts"

// A paper version's identity, as search returns it.
type VersionId = typeof Version.fields.id.Type

// How often questions asked for a version, and when one last did.
const Asked = Schema.Struct({
  version: Version.fields.id,
  count: Schema.Int.check(Schema.isGreaterThan(0)),
  last: Schema.DateTimeUtcFromString,
})

interface Asked extends Schema.Schema.Type<typeof Asked> {}

// D1 failed, the Worker binds no DB, or the table holds a row the writer
// never writes.
export class DemandUnavailable extends Schema.TaggedError<
  DemandUnavailable,
  { readonly brand: unique symbol }
>()("DemandUnavailable", { cause: Schema.Defect() }) {}

interface Interface {
  // Counts one more question for each version, once however often it
  // repeats, in one statement. Starts no Workflow and calls no model.
  readonly record: (versions: ReadonlyArray<VersionId>) => Effect.Effect<void, DemandUnavailable>
  // The versions asked for at or after `time`, most asked first, with how
  // often questions asked for them in all. For the daily annotation run,
  // never a request.
  readonly since: (time: DateTime.Utc) => Effect.Effect<ReadonlyArray<Asked>, DemandUnavailable>
}

// One row per version a question asked for. `last` is ISO 8601 UTC, so it
// compares as text.
const tables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    CREATE TABLE IF NOT EXISTS demand (
      version TEXT PRIMARY KEY,
      count INTEGER NOT NULL CHECK (count > 0),
      last TEXT NOT NULL
    )
  `
})

const unavailable = (cause: unknown) => new DemandUnavailable({ cause })

// Which unannotated papers questions asked for, in the stage's own DB, where
// requests write (docs/papers.md#demand). Never in PAPERS_DB: requests only
// read the paper store.
export class Demand extends Context.Service<Demand, Interface>()("@repo/server/Demand") {
  // Needs a SqlClient.
  static readonly make = Layer.effect(
    Demand,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Made on the first call, as for the answer log.
      const ready = yield* once(tables)

      const record = Effect.fn("Demand.record")(function* (versions: ReadonlyArray<VersionId>) {
        if (versions.length === 0) return

        const now = DateTime.formatIso(yield* DateTime.now)

        yield* ready
        // One statement whatever the number of versions: D1 caps a
        // statement's bound values at 100. `WHERE true` tells SQLite the
        // ON CONFLICT clause belongs to the INSERT, not the SELECT.
        yield* sql`
            INSERT INTO demand (version, count, last)
            SELECT DISTINCT value, 1, ${now} FROM json_each(${JSON.stringify(versions)}) WHERE true
            ON CONFLICT (version) DO UPDATE SET
              count = count + 1,
              last = max(last, excluded.last)
          `
      }, Effect.mapError(unavailable))

      const find = SqlSchema.findAll({
        Request: Schema.String,
        Result: Asked,
        execute: (time) => sql`
          SELECT version, count, last FROM demand
          WHERE last >= ${time}
          ORDER BY count DESC, version
        `,
      })

      const since = Effect.fn("Demand.since")(function* (time: DateTime.Utc) {
        yield* ready

        return yield* find(DateTime.formatIso(time))
      }, Effect.mapError(unavailable))

      return Demand.of({ record, since })
    }),
  )

  static readonly none = Layer.succeed(
    Demand,
    Demand.of({
      record: () => Effect.fail(unavailable("No DB")),
      since: () => Effect.fail(unavailable("No DB")),
    }),
  )

  // DB inside Workers. Outside them, or with DB missing, every call is
  // unavailable.
  static readonly layer = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) =>
        env.DB === undefined
          ? Demand.none
          : Demand.make.pipe(Layer.provide(D1Client.layer({ db: env.DB }).pipe(Layer.orDie))),
      ),
      Effect.orElseSucceed(() => Demand.none),
    ),
  )
}
