// The ambient declaration must reach every program that compiles this file,
// including apps/web; a .d.ts cannot be imported.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="../cloudflare.d.ts" />

import { D1Client } from "@effect/sql-d1"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { fingerprint } from "../fingerprint.ts"
import { Passage } from "./archive.ts"
import {
  Bibliography,
  Body,
  Holding,
  objectsOf,
  PaperId,
  Reason,
  Text,
  Version,
  Withdrawal,
} from "./store.ts"

// What the reader needs from an R2 bucket binding.
interface PaperBucket {
  readonly get: (key: string) => Promise<{ readonly text: () => Promise<string> } | null>
}

// What the store holds for a paper: its text through its active version, or
// only its bibliography and why it has no text.
export const Held = Schema.TaggedUnion({
  Text: {
    paper: Bibliography,
    copy: Holding,
    version: Version,
    passages: Schema.NonEmptyArray(Passage),
    // The version's active annotation, if one is ready.
    annotation: Schema.NullOr(Body),
  },
  Metadata: { paper: Bibliography, reason: Reason },
  Withdrawn: { paper: Bibliography, reason: Withdrawal },
})

export type Held = typeof Held.Type

// No published paper has this id. A paper whose publication has not set an
// active version, a metadata reason or a withdrawal is not published yet.
export class PaperMissing extends Schema.TaggedError<
  PaperMissing,
  { readonly brand: unique symbol }
>()("PaperMissing", { paper: PaperId }) {}

// The store holds the paper but not what its rows promise: a text object that
// is missing, has another hash or does not decode, or a row that does not.
export class PaperCorrupt extends Schema.TaggedError<
  PaperCorrupt,
  { readonly brand: unique symbol }
>()("PaperCorrupt", { paper: PaperId, cause: Schema.Defect() }) {}

// The store could not answer: D1 or R2 failed, a table is missing, or the
// Worker binds no store.
export class PapersUnavailable extends Schema.TaggedError<
  PapersUnavailable,
  { readonly brand: unique symbol }
>()("PapersUnavailable", { cause: Schema.Defect() }) {}

// A paper's row: its bibliography, why it has no text, the withdrawal of one
// of its copies, and its active version with that version's copy and
// annotation. SQLite builds the nested JSON, so one schema decodes it all.
const Row = Schema.Struct({
  paper: Schema.fromJsonString(Bibliography),
  reason: Schema.NullOr(Reason),
  withdrawal: Schema.NullOr(Withdrawal),
  active: Schema.NullOr(
    Schema.fromJsonString(
      Schema.Struct({ copy: Holding, version: Version, annotation: Schema.NullOr(Body) }),
    ),
  ),
})

type Row = typeof Row.Type

// A copy id, as `Holding` and a cited paper's `copy` hold it.
type CopyId = typeof Holding.fields.id.Type

interface Interface {
  readonly read: (
    paper: PaperId,
  ) => Effect.Effect<Held, PaperMissing | PaperCorrupt | PapersUnavailable>
  // Which of these copies were withdrawn, and why. A copy the store does
  // not hold, or holds unwithdrawn, is not in the map.
  readonly withdrawn: (
    copies: ReadonlyArray<CopyId>,
  ) => Effect.Effect<ReadonlyMap<CopyId, Withdrawal>, PapersUnavailable>
}

// Reads papers from PAPERS_DB and PAPERS and never writes either: a preview
// reads production's (docs/papers.md).
export class Papers extends Context.Service<Papers, Interface>()("@repo/server/Papers") {
  static readonly make = (bucket: PaperBucket) =>
    Layer.effect(
      Papers,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient

        const find = SqlSchema.findOneOption({
          Request: PaperId,
          Result: Row,
          execute: (id) => sql`
            SELECT
              json_object(
                'id', paper.id, 'openalex', paper.openalex, 'study', json(paper.study),
                'work', json(paper.work), 'metadataUrl', paper.metadata_url,
                'retrievedAt', paper.retrieved_at
              ) AS paper,
              paper.reason,
              (SELECT withdrawal FROM copy WHERE copy.paper = paper.id AND withdrawal IS NOT NULL
                ORDER BY copy.id LIMIT 1) AS withdrawal,
              CASE WHEN version.id IS NULL THEN NULL ELSE json_object(
                'copy', json_object(
                  'id', copy.id, 'location', json(copy.location), 'evidence', json(copy.evidence)
                ),
                'version', json_object(
                  'id', version.id, 'extraction', version.extraction, 'url', version.url,
                  'pdf', version.pdf, 'text', version.text, 'pages', version.pages,
                  'emptyPages', json(version.empty_pages)
                ),
                'annotation', json(annotation.body)
              ) END AS active
            FROM paper
            LEFT JOIN version ON version.id = paper.active
            LEFT JOIN copy ON copy.id = version.copy
            LEFT JOIN annotation ON annotation.key = version.annotation
            WHERE paper.id = ${id}
          `,
        })

        const passagesOf = Effect.fnUntraced(function* (paper: PaperId, version: Version) {
          const corrupt = (cause: unknown) => new PaperCorrupt({ paper, cause })

          const object = yield* Effect.tryPromise({
            try: () => bucket.get(objectsOf(version.id).text),
            catch: (cause) => new PapersUnavailable({ cause }),
          })

          if (object === null) return yield* corrupt("No text object")

          const bytes = yield* Effect.tryPromise({
            try: () => object.text(),
            catch: (cause) => new PapersUnavailable({ cause }),
          })

          if ((yield* fingerprint(bytes)) !== version.text)
            return yield* corrupt("Text object hash mismatch")

          return yield* Schema.decodeEffect(Text)(bytes).pipe(Effect.mapError(corrupt))
        })

        const heldOf = Effect.fnUntraced(function* ({ paper, reason, withdrawal, active }: Row) {
          if (active !== null)
            return Held.cases.Text.make({
              paper,
              ...active,
              passages: yield* passagesOf(paper.id, active.version),
            })

          if (withdrawal !== null) return Held.cases.Withdrawn.make({ paper, reason: withdrawal })

          if (reason !== null) return Held.cases.Metadata.make({ paper, reason })

          return yield* new PaperMissing({ paper: paper.id })
        })

        const read = Effect.fn("Papers.read")(function* (paper: PaperId) {
          const row = yield* find(paper).pipe(
            Effect.catchTags({
              SchemaError: (cause) => Effect.fail(new PaperCorrupt({ paper, cause })),
              SqlError: (cause) => Effect.fail(new PapersUnavailable({ cause })),
            }),
          )

          if (Option.isNone(row)) return yield* new PaperMissing({ paper })

          return yield* heldOf(row.value)
        })

        // One statement whatever the number of copies: D1 caps a
        // statement's bound values at 100. `copy` is read by primary key.
        const withdrawals = SqlSchema.findAll({
          Request: Schema.String,
          Result: Schema.Struct({ id: Holding.fields.id, withdrawal: Withdrawal }),
          execute: (ids) => sql`
            SELECT copy.id, copy.withdrawal
            FROM json_each(${ids}) AS id
            CROSS JOIN copy ON copy.id = id.value
            WHERE copy.withdrawal IS NOT NULL
          `,
        })

        const withdrawn = Effect.fn("Papers.withdrawn")(
          function* (copies: ReadonlyArray<CopyId>) {
            if (copies.length === 0) return new Map<CopyId, Withdrawal>()

            const rows = yield* withdrawals(JSON.stringify([...new Set(copies)]))

            return new Map(rows.map(({ id, withdrawal }) => [id, withdrawal]))
          },
          Effect.mapError((cause) => new PapersUnavailable({ cause })),
        )

        return Papers.of({ read, withdrawn })
      }),
    )

  static readonly none = Layer.succeed(
    Papers,
    Papers.of({
      read: () => Effect.fail(new PapersUnavailable({ cause: "No paper store" })),
      withdrawn: () => Effect.fail(new PapersUnavailable({ cause: "No paper store" })),
    }),
  )

  // PAPERS_DB and PAPERS inside Workers. Outside them, or with either
  // binding missing, every read is unavailable.
  static readonly layer = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) =>
        env.PAPERS_DB === undefined || env.PAPERS === undefined
          ? Papers.none
          : Papers.make(env.PAPERS).pipe(
              Layer.provide(D1Client.layer({ db: env.PAPERS_DB }).pipe(Layer.orDie)),
            ),
      ),
      Effect.orElseSucceed(() => Papers.none),
    ),
  )
}
