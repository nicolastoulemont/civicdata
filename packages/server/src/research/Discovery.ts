// The ambient declaration must reach every program that compiles this file,
// including apps/web; a .d.ts cannot be imported.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="../cloudflare.d.ts" />

import { D1Client } from "@effect/sql-d1"
import { Context, Effect, Layer, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { Passage } from "./archive.ts"
import { PapersUnavailable } from "./Papers.ts"
import { Bibliography, Holding, PaperId, Reason, Version } from "./store.ts"

// A paper the store holds that a query's words found, for discovery only: it
// is not evidence and carries no citation. A match with text has the version
// it was read from, whether that version has an annotation, and up to three
// of its passages the words found, best first, each on its physical page. A
// metadata-only match has the bibliography alone and never a passage.
export const Match = Schema.TaggedUnion({
  Text: {
    paper: Bibliography,
    copy: Holding,
    version: Version,
    annotated: Schema.Boolean,
    excerpts: Schema.Array(Passage),
  },
  Metadata: { paper: Bibliography, reason: Reason },
})

export type Match = typeof Match.Type

// A query search refuses: it has no word to search for once common words are
// dropped, or more text or words than a query needs.
export class QueryInvalid extends Schema.TaggedError<
  QueryInvalid,
  { readonly brand: unique symbol }
>()("QueryInvalid", { reason: Schema.Literals(["Empty", "Long"]) }) {}

const limits = { characters: 1000, words: 16, papers: 10, excerpts: 3, hits: 100 }

// Words too common to tell papers apart. Matching them would read most of
// the index's rows.
const stop = new Set(
  "about after against all also among an and any are as at be been before being between both but by can could did do does during each for from had has have how if in into is it its may more most not of on or other our over should since so some such than that the their them then there these they this those through to under until was we were what when where which while who why will with within would".split(
    " ",
  ),
)

// The query as FTS5 reads it: each word quoted, so no operator, column
// filter or prefix in the text reaches FTS5, and any one word matches. Only
// titles and passage text are searched.
const matchOf = (text: string) =>
  Effect.gen(function* () {
    if (text.length > limits.characters) return yield* new QueryInvalid({ reason: "Long" })

    const words = new Set(
      (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
        (word) => word.length > 1 && !stop.has(word),
      ),
    )

    if (words.size === 0) return yield* new QueryInvalid({ reason: "Empty" })

    if (words.size > limits.words) return yield* new QueryInvalid({ reason: "Long" })

    return `{title text} : (${[...words].map((word) => `"${word}"`).join(" OR ")})`
  })

// A reference list cites titles that share a query's words without being
// about them. It reads as dense citations: author initials, years followed
// by a title, volumes with issues, page numbers and DOIs. Measured on the 502
// labelled passages of the corpus fixture in test/fixtures/papers, this
// finds 34 of the 42 reference passages and 6 of the 460 others, mostly
// tables and title pages.
const citations = [
  /\b\p{Lu}[\p{L}'’-]+,? (?:\p{Lu}\.? ?){1,3}(?:,|and\b|\(|&)/gu,
  /(?:\(\d{4}[a-z]?\)|\b\d{4}[a-z]?)\.?\s+[‘“"]?\p{Lu}/gu,
  /\b\d+\s?\(\d+\)/g,
  /\bpp?\.\s?\d|doi\.org|\bdoi:/g,
]

export const listsReferences = (text: string) => {
  const found = citations.reduce((sum, pattern) => sum + (text.match(pattern)?.length ?? 0), 0)

  return found >= 3 && found / text.split(/\s+/).length >= 0.04
}

// One row the index matched: a paper's title, or a passage of the paper's
// active version. FTS5's bm25 is lower for a better match.
const Hit = Schema.Union([
  Schema.Struct({ paper: PaperId, version: Schema.Null, score: Schema.Finite }),
  Schema.Struct({
    paper: PaperId,
    version: Version.fields.id,
    page: Passage.fields.page,
    part: Passage.fields.part,
    text: Passage.fields.text,
    score: Schema.Finite,
  }),
])

// A matched paper as the store holds it now.
const Row = Schema.Struct({
  paper: Schema.fromJsonString(Bibliography),
  reason: Schema.NullOr(Reason),
  active: Schema.NullOr(
    Schema.fromJsonString(
      Schema.Struct({ copy: Holding, version: Version, annotated: Schema.Boolean }),
    ),
  ),
})

interface Ranked {
  readonly paper: PaperId
  // The version the excerpts come from, if any.
  readonly version: typeof Version.fields.id.Type | null
  readonly score: number
  readonly excerpts: ReadonlyArray<typeof Passage.Type>
}

// Groups hits by paper, best first. A paper scores the sum of its title's
// hit and its best three passages' hits, so a paper whose title and text
// both match rises above one that mentions the words once. A passage that
// lists references neither scores nor shows.
const rank = (hits: ReadonlyArray<typeof Hit.Type>) => {
  const papers = new Map<PaperId, Ranked>()

  for (const hit of hits) {
    const ranked = papers.get(hit.paper) ?? {
      paper: hit.paper,
      version: null,
      score: 0,
      excerpts: [],
    }

    if (hit.version === null) {
      papers.set(hit.paper, { ...ranked, score: ranked.score + hit.score })
    } else if (ranked.excerpts.length < limits.excerpts && !listsReferences(hit.text)) {
      const { page, part, text } = hit

      papers.set(hit.paper, {
        ...ranked,
        version: hit.version,
        score: ranked.score + hit.score,
        excerpts: [...ranked.excerpts, { page, part, text }],
      })
    }
  }

  return [...papers.values()]
    .toSorted((a, b) => a.score - b.score || a.paper.localeCompare(b.paper))
    .slice(0, limits.papers)
}

interface Interface {
  // At most ten papers, best first, each with at most three passages.
  readonly search: (
    query: string,
  ) => Effect.Effect<ReadonlyArray<Match>, QueryInvalid | PapersUnavailable>
}

// Finds papers in PAPERS_DB by the words of their titles and passages, with
// BM25. It only reads: it records no demand and schedules nothing.
export class Discovery extends Context.Service<Discovery, Interface>()("@repo/server/Discovery") {
  static readonly make = Layer.effect(
    Discovery,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // The index's best rows of published papers: a title row of a paper
      // with text or a metadata reason, or a passage row of a paper's active
      // version. bm25's weights follow the index's columns: a word in a title
      // counts ten times one in a passage. The full-text table leads the
      // join, so only rows the words match are read.
      const hits = SqlSchema.findAll({
        Request: Schema.String,
        Result: Hit,
        execute: (match) => sql`
          SELECT paper.id AS paper, search.version, search.page, search.part, search.text,
            bm25(search, 0.0, 0.0, 0.0, 0.0, 10.0, 1.0) AS score
          FROM search
          LEFT JOIN version ON version.id = search.version
          CROSS JOIN paper ON paper.id = coalesce(search.paper, version.paper)
          WHERE search MATCH ${match}
            AND CASE WHEN search.version IS NULL
              THEN paper.active IS NOT NULL OR paper.reason IS NOT NULL
              ELSE paper.active = search.version END
          ORDER BY score
          LIMIT ${limits.hits}
        `,
      })

      const rows = SqlSchema.findAll({
        Request: Schema.String,
        Result: Row,
        execute: (ids) => sql`
          SELECT
            json_object(
              'id', paper.id, 'openalex', paper.openalex, 'study', json(paper.study),
              'work', json(paper.work), 'metadataUrl', paper.metadata_url,
              'retrievedAt', paper.retrieved_at
            ) AS paper,
            paper.reason,
            CASE WHEN version.id IS NULL THEN NULL ELSE json_object(
              'copy', json_object(
                'id', copy.id, 'location', json(copy.location), 'evidence', json(copy.evidence)
              ),
              'version', json_object(
                'id', version.id, 'extraction', version.extraction, 'url', version.url,
                'pdf', version.pdf, 'text', version.text, 'pages', version.pages,
                'emptyPages', json(version.empty_pages)
              ),
              'annotated', json(iif(version.annotation IS NULL, 'false', 'true'))
            ) END AS active
          FROM json_each(${ids}) AS id
          CROSS JOIN paper ON paper.id = id.value
          LEFT JOIN version ON version.id = paper.active
          LEFT JOIN copy ON copy.id = version.copy
        `,
      })

      const search = Effect.fn("Discovery.search")(
        function* (query: string) {
          const ranked = rank(yield* hits(yield* matchOf(query)))

          if (ranked.length === 0) return []

          const found = yield* rows(JSON.stringify(ranked.map(({ paper }) => paper)))
          const byId = new Map(found.map((row) => [row.paper.id, row]))

          // A paper whose rows changed between the two reads is left out.
          return ranked.flatMap(({ paper, version, excerpts }): ReadonlyArray<Match> => {
            const row = byId.get(paper)

            if (row === undefined) return []

            if (row.active !== null && (version === null || version === row.active.version.id))
              return [Match.cases.Text.make({ paper: row.paper, ...row.active, excerpts })]

            if (row.active === null && row.reason !== null)
              return [Match.cases.Metadata.make({ paper: row.paper, reason: row.reason })]

            return []
          })
        },
        Effect.catchTags({
          SqlError: (cause) => Effect.fail(new PapersUnavailable({ cause })),
          SchemaError: Effect.die,
        }),
      )

      return Discovery.of({ search })
    }),
  )

  static readonly none = Layer.succeed(
    Discovery,
    Discovery.of({
      search: () => Effect.fail(new PapersUnavailable({ cause: "No paper store" })),
    }),
  )

  // PAPERS_DB inside Workers. Outside them, or without the binding, every
  // search is unavailable.
  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const { env } = yield* Effect.tryPromise(() => import("cloudflare:workers"))

      if (env.PAPERS_DB === undefined) return Discovery.none

      return Discovery.make.pipe(
        Layer.provide(D1Client.layer({ db: env.PAPERS_DB }).pipe(Layer.orDie)),
      )
    }).pipe(Effect.orElseSucceed(() => Discovery.none)),
  )
}
