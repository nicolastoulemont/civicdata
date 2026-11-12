import { Failure, Source, SourceUnavailable } from "@openfacts/domain"
import { DateTime, Effect, Option, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { AssetId, Versions } from "./Adapter.ts"
import { failureOf } from "./Failure.ts"
import { layout } from "./Store.ts"

// Why an asset failed: what its source did, or something on our side, such
// as the store, the database, or a Workflow step that lost its error's type.
const Internal = Schema.TaggedStruct("Internal", {})

export const Reason = Schema.Union([Failure, Internal])

export type Reason = typeof Reason.Type

export const reasonOf = (error: { readonly _tag: string }): Reason =>
  error instanceof SourceUnavailable ? failureOf(error) : Internal.make({})

// The reasons that say the publisher will answer the same way again: it
// refused the request, or sent what we cannot read. After three failed runs
// on the same version, an asset whose last failure was one of these waits a
// week. Any other failure (no answer, a 5xx, a 429, our side) is retried on
// the next run.
const lasting = JSON.stringify(["Refused", "Unreadable"] satisfies ReadonlyArray<Reason["_tag"]>)

// Kept as a tagged union so later policies can add an Unstorable decision.
// A failure recorded before reasons were classified holds a string, which
// never starts a backoff.
const Gathered = Schema.TaggedUnion({
  Stored: { version: Schema.String, at: Schema.DateTimeUtcFromString },
  Failed: {
    wanted: Schema.String,
    stored: Schema.OptionFromNullOr(Schema.String),
    failures: Schema.Int,
    reason: Schema.Union([Reason, Schema.String]),
    at: Schema.DateTimeUtcFromString,
  },
})

const GatheredJson = Schema.fromJsonString(Gathered)

// An asset a run still wants, at the version it wants, with what the ledger
// last recorded for it.
const Wanted = Schema.Struct({
  asset: AssetId,
  version: Schema.NonEmptyString,
  state: Schema.OptionFromNullOr(GatheredJson),
})

export interface Wanted extends Schema.Schema.Type<typeof Wanted> {}

// Only Gather constructs this ledger, on the build's CATALOG_DB connection.
export const ledger = Effect.fn("GatherLedger.open")(function* (namespace = "") {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE IF NOT EXISTS series_gathered (
    scope TEXT NOT NULL,
    indicator TEXT NOT NULL,
    state TEXT NOT NULL CHECK (json_valid(state)),
    PRIMARY KEY (scope, indicator)
  )`

  const legacy = yield* sql`SELECT name FROM sqlite_master WHERE name = 'series_version'`

  if (legacy.length > 0) {
    const at = DateTime.formatIso(yield* DateTime.now)

    // INSERT OR IGNORE makes an interrupted migration safe to repeat. D1
    // has no SqlClient transactions; drop only after all rows were seeded.
    yield* Effect.gen(function* () {
      yield* sql`INSERT OR IGNORE INTO series_gathered (scope, indicator, state)
        SELECT old.scope, catalog.indicator,
          json_object('_tag', 'Stored', 'version', old.version, 'at', ${at})
        FROM catalog
        JOIN catalog_current AS current
          ON current.source = catalog.source AND current.generation = catalog.generation
        JOIN series_version AS old ON old.scope = ${`${layout}/`} || catalog.source`
      yield* sql`DROP TABLE series_version`
    })
  }

  yield* sql`CREATE TABLE IF NOT EXISTS asset_gathered (
    scope TEXT NOT NULL,
    asset TEXT NOT NULL,
    state TEXT NOT NULL CHECK (json_valid(state)),
    PRIMARY KEY (scope, asset)
  )`
  // Only World Bank's deployed per-indicator units have the same identity.
  // Copy every layout verbatim, including failures; never infer success from R2.
  yield* sql`INSERT OR IGNORE INTO asset_gathered (scope, asset, state)
    SELECT scope, indicator, state FROM series_gathered
    WHERE scope IN ('series/v1/World Bank', 'series/v2/World Bank')`

  const work = SqlSchema.findAll({
    Request: Schema.Struct({
      source: Source,
      versions: Versions,
      after: Schema.String,
      now: Schema.String,
    }),
    Result: Wanted,
    execute: ({ source, versions, after, now }) => sql`
      SELECT json_extract(wanted.value, '$.asset') AS asset,
        json_extract(wanted.value, '$.version') AS version, gathered.state
      FROM json_each(${JSON.stringify(versions)}) AS wanted
      LEFT JOIN asset_gathered AS gathered
        ON gathered.scope = ${`${layout}/${source}${namespace}`}
        AND gathered.asset = json_extract(wanted.value, '$.asset')
      WHERE json_extract(wanted.value, '$.asset') > ${after}
        AND (CASE json_extract(gathered.state, '$._tag')
          WHEN 'Stored' THEN json_extract(gathered.state, '$.version')
          ELSE json_extract(gathered.state, '$.stored') END
          IS NOT json_extract(wanted.value, '$.version'))
        AND (COALESCE(json_extract(gathered.state, '$.failures'), 0) < 3
          OR json_extract(gathered.state, '$.wanted') IS NOT json_extract(wanted.value, '$.version')
          OR COALESCE(json_extract(gathered.state, '$.reason._tag'), '')
            NOT IN (SELECT value FROM json_each(${lasting}))
          OR julianday(${now}) - julianday(json_extract(gathered.state, '$.at')) >= 7)
      ORDER BY asset LIMIT 50`,
  })

  const summary = SqlSchema.findOne({
    Request: Schema.Struct({ source: Source, versions: Versions, now: Schema.String }),
    Result: Schema.Struct({ unchanged: Schema.Int, backedOff: Schema.Int }),
    execute: ({ source, versions, now }) => sql`
      WITH entries AS (
        SELECT json_extract(wanted.value, '$.version') AS version,
          json_extract(state, '$._tag') AS tag,
          json_extract(state, '$.version') AS stored,
          json_extract(state, '$.wanted') AS wanted,
          json_extract(state, '$.failures') AS failures,
          json_extract(state, '$.reason._tag') AS reason,
          json_extract(state, '$.at') AS at
        FROM json_each(${JSON.stringify(versions)}) AS wanted
        LEFT JOIN asset_gathered ON scope = ${`${layout}/${source}${namespace}`}
          AND asset = json_extract(wanted.value, '$.asset')
      )
      SELECT count(CASE WHEN tag = 'Stored' AND stored = version THEN 1 END) AS unchanged,
        count(CASE WHEN tag = 'Failed' AND failures >= 3 AND wanted = version
          AND reason IN (SELECT value FROM json_each(${lasting}))
          AND julianday(${now}) - julianday(at) < 7 THEN 1 END) AS backedOff
      FROM entries`,
  })

  const record = Effect.fn("Gather.record")(function* (
    asset: AssetId,
    { source, state }: { source: Source; state: typeof Gathered.Type },
  ) {
    const encoded = yield* Schema.encodeEffect(GatheredJson)(state)
    yield* sql`INSERT INTO asset_gathered (scope, asset, state)
      VALUES (${`${layout}/${source}${namespace}`}, ${asset}, ${encoded})
      ON CONFLICT (scope, asset) DO UPDATE SET state = excluded.state`
  })

  const stored = Effect.fn("Gather.stored")(function* (
    asset: AssetId,
    { source, version }: { source: Source; version: string },
  ) {
    yield* record(asset, {
      source,
      state: Gathered.cases.Stored.make({ version, at: yield* DateTime.now }),
    })
  })

  const failed = Effect.fn("Gather.failed")(function* (
    asset: AssetId,
    {
      source,
      version,
      previous,
      reason,
    }: {
      source: Source
      version: string
      previous: Option.Option<typeof Gathered.Type>
      reason: Reason
    },
  ) {
    const last = Option.match(previous, {
      onNone: () => ({ stored: Option.none<string>(), failures: 0 }),
      onSome: (previousState) =>
        Gathered.match(previousState, {
          Stored: (state) => ({ stored: Option.some(state.version), failures: 0 }),
          Failed: (state) => ({ stored: state.stored, failures: state.failures }),
        }),
    })

    const failures = last.failures + 1

    yield* record(asset, {
      source,
      state: Gathered.cases.Failed.make({
        wanted: version,
        stored: last.stored,
        failures,
        reason,
        at: yield* DateTime.now,
      }),
    })
    yield* Effect.logWarning("Could not gather", { asset, reason, failures })
  })

  return { work, stored, failed, summary }
})
