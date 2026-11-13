import { D1Client } from "@effect/sql-d1"
import { Source, sourceOf, pathOf, SourceUnavailable } from "@repo/domain"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { orUnbuilt } from "../platform/built.ts"
import { fingerprint } from "../utils/fingerprint.ts"
import { Release } from "./Adapter.ts"
import { ledger } from "./GatherLedger.ts"

const Manifest = Schema.Struct({
  release: Release,
  namespace: Schema.NonEmptyString,
  base: Schema.NullOr(Schema.String),
})

interface Manifest extends Schema.Schema.Type<typeof Manifest> {}

const Json = Schema.fromJsonString(Manifest)

export const releaseTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS series_release (
    source TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, manifest TEXT NOT NULL CHECK(json_valid(manifest))
  )`
})

interface Interface {
  readonly current: (source: Source) => Effect.Effect<Option.Option<Manifest>, SourceUnavailable>
  readonly prepare: (
    source: Source,
    release: Release,
  ) => Effect.Effect<Option.Option<Manifest>, SourceUnavailable>
  readonly activate: (source: Source, manifest: Manifest) => Effect.Effect<void, SourceUnavailable>
}

export class Releases extends Context.Service<Releases, Interface>()("@repo/server/Releases") {
  static readonly layer = Layer.effect(
    Releases,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const find = SqlSchema.findOneOption({
        Request: Source,
        Result: Schema.Struct({ manifest: Json }),
        execute: (source) => sql`SELECT manifest FROM series_release WHERE source = ${source}`,
      })

      const current = Effect.fn("Releases.current")(function* (source: Source) {
        return yield* find(source).pipe(
          orUnbuilt({
            sql,
            tables: ["series_release"],
            value: Option.none<{ readonly manifest: Manifest }>(),
          }),
          Effect.map(Option.map(({ manifest }) => manifest)),
          Effect.mapError(() => new SourceUnavailable({ source, reason: "StoreUnavailable" })),
        )
      })

      const prepare = Effect.fn("Releases.prepare")(function* (source: Source, input: Release) {
        const release = yield* Schema.decodeEffect(Release)(input).pipe(
          Effect.mapError(() => new SourceUnavailable({ source })),
        )

        const assets = release.assets.map(({ asset }) => asset)
        const members = release.assets.flatMap(({ members: keys }) => keys)
        const keys = members.map(pathOf)

        if (
          new Set(assets).size !== assets.length ||
          new Set(keys).size !== keys.length ||
          members.some(({ indicator }) => sourceOf(indicator) !== source)
        ) {
          return yield* new SourceUnavailable({ source })
        }

        const active = yield* current(source)

        if (Option.isSome(active) && active.value.release.order >= release.order)
          return Option.none<Manifest>()

        // Removal is rejected. A future explicit removal policy must also account
        // for dimensions and country-years; omission never means permission.
        if (
          Option.isSome(active) &&
          active.value.release.assets
            .flatMap((asset) => asset.members)
            .some((key) => !keys.includes(pathOf(key)))
        ) {
          return yield* new SourceUnavailable({ source })
        }

        const base = Option.isSome(active) ? active.value.namespace : null
        const namespace = yield* fingerprint(JSON.stringify({ source, release, base }))

        return Option.some({ release, namespace, base })
      })

      const activate = Effect.fn("Releases.activate")(function* (
        source: Source,
        manifest: Manifest,
      ) {
        const decoded = yield* Schema.decodeEffect(Manifest)(manifest).pipe(
          Effect.mapError(() => new SourceUnavailable({ source })),
        )

        const hash = yield* fingerprint(
          JSON.stringify({ source, release: decoded.release, base: decoded.base }),
        )

        if (hash !== decoded.namespace) return yield* new SourceUnavailable({ source })

        const progress = yield* ledger(`/${manifest.namespace}`).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.mapError(() => new SourceUnavailable({ source })),
        )

        const done = yield* progress
          .summary({
            source,
            now: DateTime.formatIso(yield* DateTime.now),
            versions: manifest.release.assets.map(({ asset }) => ({
              asset,
              version: manifest.release.version,
            })),
          })
          .pipe(Effect.mapError(() => new SourceUnavailable({ source })))

        if (done.unchanged !== manifest.release.assets.length)
          return yield* new SourceUnavailable({ source })

        const text = yield* Schema.encodeEffect(Json)(manifest).pipe(
          Effect.mapError(() => new SourceUnavailable({ source })),
        )

        // The conditional write is the publication boundary. Equal and older
        // ordinals cannot replace a release, including concurrent/replayed runs.
        yield* sql`INSERT INTO series_release (source, ordinal, manifest)
        VALUES (${source}, ${manifest.release.order}, ${text})
        ON CONFLICT(source) DO UPDATE SET ordinal = excluded.ordinal, manifest = excluded.manifest
        WHERE series_release.ordinal < excluded.ordinal
          AND json_extract(series_release.manifest, '$.namespace') = ${manifest.base}`.pipe(
          Effect.mapError(() => new SourceUnavailable({ source, reason: "StoreUnavailable" })),
        )
        const published = yield* current(source)

        if (Option.isNone(published) || published.value.namespace !== manifest.namespace)
          return yield* new SourceUnavailable({ source })

        return undefined
      })

      return Releases.of({ current, prepare, activate })
    }),
  )

  static readonly live = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) =>
        env.CATALOG_DB === undefined
          ? Releases.none
          : Releases.layer.pipe(
              Layer.provide(D1Client.layer({ db: env.CATALOG_DB }).pipe(Layer.orDie)),
            ),
      ),
      Effect.orElseSucceed(() => Releases.none),
    ),
  )
  static readonly none = Layer.succeed(
    Releases,
    Releases.of({
      current: () => Effect.succeedNone,
      prepare: (source) => Effect.fail(new SourceUnavailable({ source })),
      activate: (source) => Effect.fail(new SourceUnavailable({ source })),
    }),
  )
}
