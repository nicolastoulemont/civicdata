import { IndicatorId, Source } from "@civicdata/domain"
import { DateTime, Effect, Option, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { Versions } from "./Adapter.ts"
import { layout } from "./Store.ts"

// Kept as a tagged union so later policies can add an Unstorable decision.
const Gathered = Schema.TaggedUnion({
  Stored: { version: Schema.String, at: Schema.DateTimeUtcFromString },
  Failed: {
    wanted: Schema.String,
    stored: Schema.OptionFromNullOr(Schema.String),
    failures: Schema.Int,
    reason: Schema.String,
    at: Schema.DateTimeUtcFromString,
  },
})

const GatheredJson = Schema.fromJsonString(Gathered)

// Only Gather constructs this ledger, on the build's CATALOG_DB connection.
export const ledger = Effect.gen(function* () {
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

  const work = SqlSchema.findAll({
    Request: Schema.Struct({
      source: Source,
      versions: Versions,
      after: Schema.String,
      now: Schema.String,
    }),
    Result: Schema.Struct({
      indicator: IndicatorId,
      name: Schema.NonEmptyString,
      definition: Schema.String,
      version: Schema.String,
      state: Schema.OptionFromNullOr(GatheredJson),
    }),
    execute: ({ source, versions, after, now }) => {
      return sql`
        SELECT catalog.indicator, catalog.name, catalog.definition,
          json_extract(wanted.value, '$.version') AS version, gathered.state
        FROM catalog
        JOIN catalog_current AS current
          ON current.source = catalog.source AND current.generation = catalog.generation
        JOIN json_each(${JSON.stringify(versions)}) AS wanted
          ON json_extract(wanted.value, '$.indicator') = catalog.indicator
        LEFT JOIN series_gathered AS gathered
          ON gathered.scope = ${`${layout}/${source}`} AND gathered.indicator = catalog.indicator
        WHERE catalog.source = ${source} AND catalog.indicator > ${after}
          AND (CASE json_extract(gathered.state, '$._tag')
            WHEN 'Stored' THEN json_extract(gathered.state, '$.version')
            ELSE json_extract(gathered.state, '$.stored') END
            IS NOT json_extract(wanted.value, '$.version'))
          AND (COALESCE(json_extract(gathered.state, '$.failures'), 0) < 3
            OR json_extract(gathered.state, '$.wanted') IS NOT json_extract(wanted.value, '$.version')
            OR julianday(${now}) - julianday(json_extract(gathered.state, '$.at')) >= 7)
        ORDER BY catalog.indicator LIMIT 50`
    },
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
          json_extract(state, '$.at') AS at
        FROM json_each(${JSON.stringify(versions)}) AS wanted
        LEFT JOIN series_gathered ON scope = ${`${layout}/${source}`}
          AND indicator = json_extract(wanted.value, '$.indicator')
      )
      SELECT count(CASE WHEN tag = 'Stored' AND stored = version THEN 1 END) AS unchanged,
        count(CASE WHEN tag = 'Failed' AND failures >= 3 AND wanted = version
          AND julianday(${now}) - julianday(at) < 7 THEN 1 END) AS backedOff
      FROM entries`,
  })

  const record = Effect.fn("Gather.record")(function* (
    indicator: IndicatorId,
    { source, state }: { source: Source; state: typeof Gathered.Type },
  ) {
    const encoded = yield* Schema.encodeEffect(GatheredJson)(state)
    yield* sql`INSERT INTO series_gathered (scope, indicator, state)
      VALUES (${`${layout}/${source}`}, ${indicator}, ${encoded})
      ON CONFLICT (scope, indicator) DO UPDATE SET state = excluded.state`
  })

  const stored = Effect.fn("Gather.stored")(function* (
    indicator: IndicatorId,
    { source, version }: { source: Source; version: string },
  ) {
    yield* record(indicator, {
      source,
      state: Gathered.cases.Stored.make({ version, at: yield* DateTime.now }),
    })
  })

  const failed = Effect.fn("Gather.failed")(function* (
    indicator: IndicatorId,
    {
      source,
      version,
      previous,
      reason,
    }: {
      source: Source
      version: string
      previous: Option.Option<typeof Gathered.Type>
      reason: string
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

    yield* record(indicator, {
      source,
      state: Gathered.cases.Failed.make({
        wanted: version,
        stored: last.stored,
        failures,
        reason,
        at: yield* DateTime.now,
      }),
    })
    yield* Effect.logWarning("Could not gather", { indicator, reason, failures })
  })

  return { work, stored, failed, summary }
})
