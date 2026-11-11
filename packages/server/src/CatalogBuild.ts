import type { CloudflareWorkersModule, Rpc } from "@cloudflare/workers-types"
import { D1Client } from "@effect/sql-d1"
import { CatalogEntry, Direction, IndicatorId, Source, SourceUnavailable } from "@openfacts/domain"
import {
  Array as Arr,
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Order,
  Schema,
  Stream,
} from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { Cache } from "./Cache.ts"
import { tables } from "./Catalog.ts"
import { Classifier, Classifying } from "./Classifier.ts"
import { Faostat } from "./Faostat.ts"
import { fingerprint } from "./fingerprint.ts"
import { Ilostat } from "./Ilostat.ts"
import { Insee } from "./Insee.ts"
import { searchable, Outline, Outlines } from "./Outlines.ts"
import { Pace } from "./Pace.ts"
import { Sdmx } from "./Sdmx.ts"
import { Sources } from "./Sources.ts"
import { Vectors, type VectorsUnavailable } from "./Vectors.ts"
import { WorldBank } from "./WorldBank.ts"

// The catalog's D1 inside Workers, where the Workflows that build the
// catalog, store the political records and gather the series run: the one
// layer every build writes through. A Worker that reads another stage's
// catalog binds no Workflow (packages/infra/alchemy.run.ts), so a build
// there, such as one left scheduled by a deploy that failed half way, stops
// before it writes anything.
export const database = Layer.unwrap(
  Effect.promise(() => import("cloudflare:workers")).pipe(
    Effect.flatMap(({ env }) =>
      env.CATALOG === undefined || env.GATHER === undefined
        ? Effect.die("This Worker binds no Workflow, so it builds nothing")
        : env.CATALOG_DB === undefined
          ? Effect.die("The Workflow needs the CATALOG_DB binding")
          : Effect.succeed(D1Client.layer({ db: env.CATALOG_DB }).pipe(Layer.orDie)),
    ),
  ),
)

// Each insert binds one JSON array of entries, unpacked by SQLite's json_each,
// so a write is a handful of round trips instead of one per 20 rows (D1 binds
// at most 100 parameters per statement). 250 entries is about 250 KB, well
// under D1's 2 MB limit for one bound value.
const rowsPerInsert = 250

// Entries embedded or removed per step: Workers AI embeds at most 100 texts
// per call.
const perStep = 100

// Entries classified per step, in one request to the Decisions API: the
// most questions it takes in one request.
const perRequest = 400

// How long a build holds the lease unless it releases it first. A step that
// keeps failing gives up after about an hour of retries, which fails its
// source, and a first build of every source makes about 110 embedding and
// 30 classifying steps in a row. Twelve hours outlasts such a build with
// room to spare, and still frees the lease of a build that crashed within
// the day, well before the weekly build.
const leaseFor = Duration.hours(12)

// How long a build waits before it asks for the lease again.
const poll = Duration.minutes(10)

// An entry as a generation lists it: with the labels of its dataset's
// dimensions that search embeds with its name, empty for an entry without a
// outline.
const Listed = Schema.Struct({ ...CatalogEntry.fields, labels: Schema.String })

const EntriesJson = Schema.fromJsonString(Schema.Array(CatalogEntry))

const ListedJson = Schema.fromJsonString(Schema.Array(Listed))

const Pending = Schema.Struct({ rowid: Schema.Int, ...Listed.fields })

const Unclassified = Schema.Struct({ rowid: Schema.Int, ...CatalogEntry.fields })

// Whether search shows a outlined entry, and the labels it embeds.
const Shown = Schema.Struct({
  indicator: Outline.fields.indicator,
  annual: Schema.Int,
  countries: Schema.fromJsonString(Outline.fields.countries),
  text: Schema.String,
})

const IdsJson = Schema.fromJsonString(Schema.Array(IndicatorId))

const Classified = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ ...CatalogEntry.fields, direction: Direction })),
)

// What a step hands back, which Workflows saves: a count, a cursor, a few of
// them, whether the build holds the lease, or nothing, never rows, so a
// saved result stays far below its 1 MiB limit.
type Saved =
  | number
  | string
  | boolean
  | null
  | void
  | { readonly [key: string]: number | string | null }

interface Interface {
  readonly sources: ReadonlyArray<Source>
  readonly discovery: ReadonlyMap<Source, number>
  // Takes the lease that lets one build at a time change the catalog, for
  // the Workflow instance `holder`, and answers whether it holds it. An
  // instance that already holds it takes it again, so a replayed step
  // answers the same.
  readonly take: (holder: string) => Effect.Effect<boolean>
  // Releases the lease, if `holder` still holds it.
  readonly release: (holder: string) => Effect.Effect<void>
  // Stores the outline of each of the source's datasets that changed, from the
  // files a Worker can read, and answers how many it wrote.
  readonly outline: (source: Source) => Effect.Effect<number, SourceUnavailable>
  // Asks the source for its next codelists after `after` whose codes in use
  // lack labels, and stores the labels. Answers the last codelist asked, or
  // null once none lacks labels. A codelist the source fails to give is
  // skipped until the next build.
  readonly label: (source: Source, after: string) => Effect.Effect<string | null>
  // Writes the labels each of the source's datasets embeds, where they
  // changed, and answers how many.
  readonly describe: (source: Source) => Effect.Effect<number>
  // Lists the source's indicators into the generation, replacing what an
  // earlier attempt wrote there, and answers how many it wrote. It leaves
  // out the datasets search does not show, those with no annual values or
  // none of our countries (Outlines.ts). It writes nothing and answers null
  // when the published generation holds the same entries, with the same
  // labels, embedded by the same model, or is newer. An empty list is the
  // source failing, so it never replaces a published one.
  readonly write: (
    source: Source,
    generation: number,
  ) => Effect.Effect<number | null, SourceUnavailable>
  // Embeds into Vectors the generation's next entries after the row `after`
  // that Vectors does not hold as listed, by the same model, and answers the
  // last row embedded, or null once every entry is in. An entry whose name
  // and definition did not change keeps its vector.
  readonly embed: (
    source: Source,
    { generation, after }: { generation: number; after: number },
  ) => Effect.Effect<number | null, VectorsUnavailable>
  // Points searches at the generation, unless a newer one is already
  // published, and drops the source's older generations.
  readonly publish: (source: Source, generation: number) => Effect.Effect<void>
  // Removes from Vectors up to 100 of the source's entries that its published
  // generation no longer lists, and answers how many it removed.
  readonly remove: (source: Source) => Effect.Effect<number, VectorsUnavailable>
  // Asks the model which way the published generation's next entries after
  // the row `after` are better, those without a direction for their current
  // name and definition by the same model, and stores the answers. Answers
  // the last row asked about, or null once every entry has a direction, the
  // model failed or classification is off: a failed request stores nothing,
  // so the next build asks again, and never fails the build.
  readonly classify: (source: Source, after: number) => Effect.Effect<number | null>
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
    readonly run: <A extends Saved & Rpc.Serializable<A>, E>(
      name: string,
      effect: Effect.Effect<A, E>,
    ) => Effect.Effect<A, StepFailed>
    // Sleeps as one named step: a resumed build skips a sleep that ended.
    readonly sleep: (name: string, duration: Duration.Duration) => Effect.Effect<void, StepFailed>
  }
>()("@openfacts/server/CatalogBuild/Step") {
  static readonly workflow = (step: CloudflareWorkersModule.WorkflowStep) =>
    Layer.succeed(
      Step,
      Step.of({
        run: (name, effect) =>
          Effect.tryPromise({
            try: () => step.do(name, retried, () => Effect.runPromise(effect)),
            catch: (cause) => new StepFailed({ step: name, cause }),
          }),
        sleep: (name, duration) =>
          Effect.tryPromise({
            try: () => step.sleep(name, Duration.toMillis(duration)),
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
      sleep: (_name, duration) => Effect.sleep(duration),
    }),
  )
}

// Builds a new generation of the catalog: writes, embeds and publishes the
// entries of every source, then classifies which way their values are
// better, each in its own steps. Sources build side by side,
// so one that stays down keeps its previous generation without holding back
// the others; the build then fails, naming it.
export class CatalogBuild extends Context.Service<CatalogBuild, Interface>()(
  "@openfacts/server/CatalogBuild",
) {
  static readonly layer = Layer.effect(
    CatalogBuild,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sources = yield* Sources
      const vectors = yield* Vectors
      const classifier = yield* Classifier
      const outlines = yield* Outlines

      yield* tables

      // What Vectors holds: the entry each vector embeds and the model that
      // embedded it, written after each put. A build embeds the entries that
      // differ from it and removes those the published generation dropped,
      // so a build that stopped part way leaves it true. Created here, since
      // only builds read it: a stage whose tables an earlier version made
      // gets it on its next build, which embeds each changed source in full.
      yield* sql`
        CREATE TABLE IF NOT EXISTS catalog_vector (
          indicator TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          model TEXT NOT NULL,
          name TEXT NOT NULL,
          definition TEXT NOT NULL,
          labels TEXT NOT NULL DEFAULT ''
        )
      `

      // Vectors an earlier version stored embed no labels: they get the empty
      // ones, so the next build embeds each entry with labels once more.
      const embedded = yield* sql<{ readonly name: string }>`PRAGMA table_info(catalog_vector)`

      if (!embedded.some(({ name }) => name === "labels")) {
        yield* sql`ALTER TABLE catalog_vector ADD COLUMN labels TEXT NOT NULL DEFAULT ''`
      }

      // The one build allowed to change the catalog, until it releases the
      // lease or the lease expires (milliseconds since the epoch). Builds
      // that overlap would remove the vectors of entries a newer build
      // embedded but has not published yet.
      yield* sql`
        CREATE TABLE IF NOT EXISTS catalog_lease (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          holder TEXT NOT NULL,
          expires INTEGER NOT NULL
        )
      `

      // Directions an earlier version stored record no model. They get the
      // empty one, which no classifier has, so the next build that
      // classifies asks about each once more; until then charts keep them.
      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(catalog_direction)`

      if (!columns.some(({ name }) => name === "model")) {
        yield* sql`ALTER TABLE catalog_direction ADD COLUMN model TEXT NOT NULL DEFAULT ''`
      }

      const leased = SqlSchema.findOneOption({
        Request: Schema.Void,
        Result: Schema.Struct({ holder: Schema.String }),
        execute: () => sql`SELECT holder FROM catalog_lease`,
      })

      const pending = SqlSchema.findAll({
        Request: Schema.Struct({
          source: Source,
          generation: Schema.Int,
          after: Schema.Int,
        }),
        Result: Pending,
        execute: ({ source, generation, after }) => sql`
          SELECT catalog.rowid, catalog.indicator, catalog.name, catalog.definition,
            coalesce(outline.text, '') AS labels
          FROM catalog LEFT JOIN catalog_outline AS outline ON outline.indicator = catalog.indicator
          WHERE catalog.rowid > ${after} AND catalog.source = ${source}
            AND catalog.generation = ${generation}
            AND NOT EXISTS (
              SELECT 1 FROM catalog_vector AS stored
              WHERE stored.indicator = catalog.indicator AND stored.source = catalog.source
                AND stored.model = ${vectors.model} AND stored.name = catalog.name
                AND stored.definition = catalog.definition
                AND stored.labels = coalesce(outline.text, '')
            )
          ORDER BY catalog.rowid
          LIMIT ${perStep}
        `,
      })

      // The source's entries in Vectors that neither its published generation
      // nor a newer one lists: a newer generation's vectors stay while its
      // build is still embedding them.
      const dropped = SqlSchema.findAll({
        Request: Source,
        Result: Schema.Struct({ indicator: IndicatorId }),
        execute: (source) => sql`
          SELECT indicator FROM catalog_vector WHERE source = ${source}
          EXCEPT
          SELECT catalog.indicator FROM catalog
          JOIN catalog_current AS current
            ON current.source = catalog.source AND catalog.generation >= current.generation
          WHERE catalog.source = ${source}
          LIMIT ${perStep}
        `,
      })

      // The published generation's entries after the row `after` with no
      // direction for their current name and definition, by `model`.
      const unclassified = SqlSchema.findAll({
        Request: Schema.Struct({ source: Source, after: Schema.Int, model: Schema.String }),
        Result: Unclassified,
        execute: ({ source, after, model }) => sql`
          SELECT catalog.rowid, catalog.indicator, catalog.name, catalog.definition FROM catalog
          JOIN catalog_current AS current
            ON current.source = catalog.source AND current.generation = catalog.generation
          WHERE catalog.source = ${source} AND catalog.rowid > ${after}
            AND NOT EXISTS (
              SELECT 1 FROM catalog_direction AS stored
              WHERE stored.indicator = catalog.indicator AND stored.name = catalog.name
                AND stored.definition = catalog.definition AND stored.model = ${model}
            )
          ORDER BY catalog.rowid
          LIMIT ${perRequest}
        `,
      })

      // The source's published generation and its fingerprint, if a build
      // stored one.
      const published = SqlSchema.findOneOption({
        Request: Source,
        Result: Schema.Struct({ generation: Schema.Int, fingerprint: Schema.String }),
        execute: (source) => sql`
          SELECT generation, fingerprint FROM catalog_fingerprint
          JOIN catalog_current USING (source, generation)
          WHERE source = ${source}
        `,
      })

      // The source's outlines, by indicator: whether search shows each and the
      // labels it embeds.
      const shown = SqlSchema.findAll({
        Request: Source,
        Result: Shown,
        execute: (source) =>
          sql`SELECT indicator, annual, countries, text FROM catalog_outline WHERE source = ${source}`,
      })

      const list = (source: Source) =>
        sources[source]?.list ?? Effect.fail(new SourceUnavailable({ source }))

      const take = Effect.fn("CatalogBuild.take")(
        function* (holder: string) {
          const now = yield* Clock.currentTimeMillis

          yield* sql`
            INSERT INTO catalog_lease (id, holder, expires)
            VALUES (1, ${holder}, ${now + Duration.toMillis(leaseFor)})
            ON CONFLICT (id) DO UPDATE SET holder = excluded.holder, expires = excluded.expires
            WHERE catalog_lease.holder = excluded.holder OR catalog_lease.expires <= ${now}
          `

          return Option.exists(yield* leased(), (lease) => lease.holder === holder)
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      const release = Effect.fn("CatalogBuild.release")(
        function* (holder: string) {
          yield* sql`DELETE FROM catalog_lease WHERE holder = ${holder}`
        },
        Effect.catchTag("SqlError", Effect.die),
      )

      const write = Effect.fn("CatalogBuild.write")(
        function* (source: Source, generation: number) {
          const entries = yield* list(source)

          if (!Arr.isReadonlyArrayNonEmpty(entries)) {
            return yield* new SourceUnavailable({ source })
          }

          const outlined = new Map(
            (yield* shown(source)).map((outline) => [outline.indicator, outline]),
          )

          // Sorted, since a source may list the same entries in another order.
          const kept = Arr.sortWith(
            entries.flatMap(({ indicator, name, definition }) => {
              const outline = outlined.get(indicator)

              if (outline === undefined) return [{ indicator, name, definition, labels: "" }]

              return searchable({
                annual: outline.annual === -1 ? null : outline.annual === 1,
                countries: outline.countries,
              })
                ? [{ indicator, name, definition, labels: outline.text }]
                : []
            }),
            (entry) => entry.indicator,
            Order.String,
          )

          const listed = yield* Schema.encodeEffect(ListedJson)(kept)

          const print = yield* fingerprint(`${vectors.model}\n${listed}`)

          // A newer build already published what this one would: an older
          // build that waited for the lease must not embed its stale
          // listing over the newer one's vectors.
          if (
            Option.exists(
              yield* published(source),
              (found) => found.fingerprint === print || found.generation > generation,
            )
          ) {
            return null
          }

          yield* sql`DELETE FROM catalog WHERE source = ${source} AND generation = ${generation}`

          for (const chunk of Arr.chunksOf(kept, rowsPerInsert)) {
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

          return kept.length
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      const embed = Effect.fn("CatalogBuild.embed")(
        function* (source: Source, { generation, after }: { generation: number; after: number }) {
          const batch = yield* pending({ source, generation, after })

          if (!Arr.isReadonlyArrayNonEmpty(batch)) return null

          yield* vectors.put(batch)

          const rows = yield* Schema.encodeEffect(ListedJson)(batch)

          // WHERE true keeps SQLite from reading ON CONFLICT as a join's ON.
          yield* sql`
            INSERT INTO catalog_vector (indicator, source, model, name, definition, labels)
            SELECT json_extract(value, '$.indicator'), ${source}, ${vectors.model},
              json_extract(value, '$.name'), json_extract(value, '$.definition'),
              json_extract(value, '$.labels')
            FROM json_each(${rows}) WHERE true
            ON CONFLICT (indicator) DO UPDATE SET source = excluded.source,
              model = excluded.model, name = excluded.name, definition = excluded.definition,
              labels = excluded.labels
          `

          return Arr.lastNonEmpty(batch).rowid
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      const remove = Effect.fn("CatalogBuild.remove")(
        function* (source: Source) {
          const indicators = Arr.map(yield* dropped(source), ({ indicator }) => indicator)

          if (!Arr.isReadonlyArrayNonEmpty(indicators)) return 0

          yield* vectors.remove(indicators)

          const ids = yield* Schema.encodeEffect(IdsJson)(indicators)

          yield* sql`DELETE FROM catalog_vector WHERE indicator IN (SELECT value FROM json_each(${ids}))`

          return indicators.length
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

      const classify = Effect.fn("CatalogBuild.classify")(
        function* (source: Source, after: number) {
          if (Classifying.$is("Off")(classifier)) return null

          const batch = yield* unclassified({ source, after, model: classifier.model })

          if (!Arr.isReadonlyArrayNonEmpty(batch)) return null

          const answered = yield* classifier.classify(batch).pipe(
            Effect.tapError((error) =>
              Effect.logWarning("Classifying directions failed", source, error.cause),
            ),
            Effect.option,
          )

          if (Option.isNone(answered)) return null

          const rows = yield* Schema.encodeEffect(Classified)(
            batch.map(({ indicator, name, definition }) => ({
              indicator,
              name,
              definition,
              direction: answered.value.get(indicator) ?? "Neutral",
            })),
          )

          yield* sql`
            INSERT INTO catalog_direction (indicator, name, definition, direction, model)
            SELECT json_extract(value, '$.indicator'), json_extract(value, '$.name'),
              json_extract(value, '$.definition'), json_extract(value, '$.direction'),
              ${classifier.model}
            FROM json_each(${rows}) WHERE true
            ON CONFLICT (indicator) DO UPDATE SET name = excluded.name,
              definition = excluded.definition, direction = excluded.direction,
              model = excluded.model
          `

          return Arr.lastNonEmpty(batch).rowid
        },
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      const outline = Effect.fn("CatalogBuild.outline")(function* (source: Source) {
        return yield* outlines.write(source, sources[source]?.discovery?.outlines ?? Stream.empty)
      })

      const label = Effect.fn("CatalogBuild.label")(function* (source: Source, after: string) {
        const codelists = sources[source]?.discovery?.codelists

        if (codelists === undefined) return null

        const listed = yield* outlines.unlabelled(source, {
          after,
          limit: codelists.perStep,
        })

        if (!Arr.isReadonlyArrayNonEmpty(listed)) return null

        for (const codelist of listed) {
          yield* codelists.labels(codelist).pipe(
            Effect.flatMap((labels) => outlines.label(source, { codelist, labels })),
            Effect.catchTag("SourceUnavailable", () => Effect.void),
          )
        }

        return Arr.lastNonEmpty(listed)
      })

      return CatalogBuild.of({
        sources: Object.keys(sources).map((source) => Source.make(source)),
        discovery: new Map(
          Object.entries(sources).flatMap(([source, adapter]) =>
            adapter.discovery === undefined
              ? []
              : [[Source.make(source), adapter.discovery.codelists?.steps ?? 0]],
          ),
        ),
        take,
        release,
        outline,
        label,
        describe: outlines.describe,
        write,
        embed,
        publish,
        remove,
        classify,
      })
    }).pipe(Effect.orDie),
  )

  // Inside Workers, where the Workflow runs, with D1 and paced sources. The
  // Workflow provides the Classifier (CatalogWorkflow.ts).
  static readonly live = CatalogBuild.layer.pipe(
    Layer.provide(Outlines.layer),
    Layer.provide(database),
    Layer.provide(Vectors.live),
    Layer.provide(Sources.layer),
    Layer.provide(Insee.cached),
    Layer.provide(Ilostat.layer),
    Layer.provide(Faostat.layer),
    Layer.provide(WorldBank.cached),
    Layer.provide(Sdmx.cached),
    Layer.provide(Pace.gathering),
    Layer.provide(Cache.layer),
  )

  // One generation of every source, numbered by the build's start time, so
  // a resumed build writes the same generation and a later build a newer one.
  // The build first waits for the lease, held by the Workflow instance `id`,
  // so builds never overlap: CI starts one on every deploy, on top of the
  // weekly one. It waits rather than giving up, so the build a deploy
  // started still runs that deploy's code once the earlier build ends. A
  // source whose published generation already holds its listing skips to
  // classifying. The step saves that decision, so a resumed build
  // makes the same one. Every other decision, what to embed, remove and
  // classify, is read from D1 inside a step, which saves only a cursor or a
  // count.
  static readonly run = Effect.fn("CatalogBuild.run")(function* ({
    id,
    generation,
  }: {
    id: string
    generation: number
  }) {
    const step = yield* Step
    const build = yield* CatalogBuild

    let waits = 0

    while (!(yield* step.run(`lease after ${waits} waits`, build.take(id)))) {
      waits += 1
      yield* step.sleep(`wait ${waits} for the lease`, poll)
    }

    // A release that fails leaves the lease to expire.
    const release = step
      .run("release the lease", build.release(id))
      .pipe(Effect.catch((error) => Effect.logWarning("Releasing the catalog lease failed", error)))

    // Embeds and publishes a written generation.
    const refresh = Effect.fn("CatalogBuild.refresh")(function* (source: Source) {
      let after: number | null = 0

      while (after !== null) {
        after = yield* step.run(
          `embed ${source} after ${after}`,
          build.embed(source, { generation, after }),
        )
      }

      yield* step.run(`publish ${source}`, build.publish(source, generation))

      // After publishing, so search by meaning never misses an entry the
      // published generation lists. Until then, search drops the neighbors
      // it no longer lists (Catalog.ts).
      let removed = 0
      let count = perStep

      while (count === perStep) {
        count = yield* step.run(`remove ${source} after ${removed}`, build.remove(source))
        removed += count
      }
    })

    // Stores the outlines of a source's datasets, the labels their codes lack
    // and the labels search embeds, before its entries are written. Outlines
    // the source fails to give leave the stored ones in place.
    const refine = Effect.fn("CatalogBuild.refine")(function* (source: Source) {
      yield* step.run(`outline ${source}`, build.outline(source))

      let after: string | null = ""

      for (
        let steps = 0;
        after !== null && steps < (build.discovery.get(source) ?? 0);
        steps += 1
      ) {
        after = yield* step.run(`label ${source} after ${after}`, build.label(source, after))
      }

      yield* step.run(`describe ${source}`, build.describe(source))
    })

    const one = Effect.fn("CatalogBuild.source")(function* (source: Source) {
      if (build.discovery.has(source)) yield* refine(source)

      const written = yield* step.run(`write ${source}`, build.write(source, generation))

      if (written !== null) yield* refresh(source)

      // Every build, so a source whose listing did not change still gets the
      // directions it lacks.
      let after: number | null = 0

      while (after !== null) {
        after = yield* step.run(`classify ${source} after ${after}`, build.classify(source, after))
      }

      return source
    })

    const [, failed] = yield* Effect.partition(
      build.sources,
      (source) =>
        one(source).pipe(
          Effect.tapError((error) => Effect.logError("Catalog build failed", source, error)),
          Effect.mapError(() => source),
        ),
      { concurrency: "unbounded" },
    ).pipe(Effect.ensuring(release))

    return yield* Arr.isArrayNonEmpty(failed)
      ? Effect.fail(new BuildFailed({ sources: failed }))
      : Effect.void
  })
}
