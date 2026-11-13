import { assert, beforeEach, describe, expect, it } from "@effect/vitest"
import { reset } from "cloudflare:test"
import { Cause, Effect } from "effect"
import { SqlClient, type SqlError } from "effect/sql"

import {
  Held,
  PaperCorrupt,
  PaperMissing,
  Papers,
  PapersUnavailable,
} from "../src/research/Papers.ts"
import { PaperId, tables } from "../src/research/store.ts"
import { bibliography, body, list, papersDb, passages, publish, withdraw } from "./papers.ts"

// The reader as the Worker builds it, over its PAPERS_DB and PAPERS bindings.
const reader = Papers.layer

const other = PaperId.make("e".repeat(64))

beforeEach(() => reset())

// The tables in PAPERS_DB.
const created = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  return yield* sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'`
}).pipe(Effect.provide(papersDb))

// A paper the reader holds text for.
const textOf = (held: Held) => {
  assert(Held.guards.Text(held), "Expected the paper's text")

  return held
}

// Why PAPERS_DB refused a statement, with every cause's message.
const refused = (
  statement: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, SqlError.SqlError>,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const error = yield* statement(sql).pipe(Effect.flip)

    return Cause.pretty(Cause.fail(error))
  }).pipe(Effect.provide(papersDb))

describe("the paper reader", () => {
  it.effect("reads a published paper's text and active annotation", () =>
    Effect.gen(function* () {
      const { paper } = yield* publish().pipe(Effect.provide(papersDb))
      const held = textOf(yield* (yield* Papers).read(paper))

      expect(held.paper).toEqual(bibliography())
      expect(held.passages).toEqual(passages())
      expect(held.annotation).toEqual(body())
      expect(held.copy.location.pdf_url).toBe("https://example.org/training.pdf")
    }).pipe(Effect.provide(reader)),
  )

  it.effect("reads a version no annotation is ready for", () =>
    Effect.gen(function* () {
      const { paper } = yield* publish({ annotation: null }).pipe(Effect.provide(papersDb))

      expect(textOf(yield* (yield* Papers).read(paper)).annotation).toBeNull()
    }).pipe(Effect.provide(reader)),
  )

  it.effect("shares one annotation between copies with the same text", () =>
    Effect.gen(function* () {
      yield* publish().pipe(Effect.provide(papersDb))
      yield* publish({ paper: bibliography({ id: other }) }).pipe(Effect.provide(papersDb))

      expect(textOf(yield* (yield* Papers).read(other)).annotation).toEqual(body())
    }).pipe(Effect.provide(reader)),
  )

  it.effect("tells a metadata-only paper and a withdrawn one apart, without text", () =>
    Effect.gen(function* () {
      const listed = yield* list({ reason: "licence-conflict" }).pipe(Effect.provide(papersDb))

      const withdrawn = yield* withdraw({
        paper: bibliography({ id: other }),
        reason: "Retraction",
      }).pipe(Effect.provide(papersDb))

      const papers = yield* Papers

      expect(yield* papers.read(listed)).toEqual(
        Held.cases.Metadata.make({ paper: bibliography(), reason: "licence-conflict" }),
      )
      expect(yield* papers.read(withdrawn)).toEqual(
        Held.cases.Withdrawn.make({ paper: bibliography({ id: other }), reason: "Retraction" }),
      )
    }).pipe(Effect.provide(reader)),
  )

  it.effect("answers missing for an unknown paper and one whose publication is unfinished", () =>
    Effect.gen(function* () {
      const papers = yield* Papers

      yield* tables.pipe(Effect.provide(papersDb))

      expect(yield* papers.read(other).pipe(Effect.flip)).toBeInstanceOf(PaperMissing)

      // A writer that stopped before setting the active version.
      yield* publish().pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient

            yield* sql`UPDATE paper SET active = NULL`
          }),
        ),
        Effect.provide(papersDb),
      )

      expect(yield* papers.read(bibliography().id).pipe(Effect.flip)).toBeInstanceOf(PaperMissing)
    }).pipe(Effect.provide(reader)),
  )

  it.effect("answers corrupt for a missing text object or one with another hash", () =>
    Effect.gen(function* () {
      const papers = yield* Papers
      const { paper } = yield* publish({ object: null }).pipe(Effect.provide(papersDb))

      expect(yield* papers.read(paper).pipe(Effect.flip)).toBeInstanceOf(PaperCorrupt)

      yield* publish({
        paper: bibliography({ id: other }),
        object: JSON.stringify(passages().slice(1)),
      }).pipe(Effect.provide(papersDb))

      expect(yield* papers.read(other).pipe(Effect.flip)).toBeInstanceOf(PaperCorrupt)
    }).pipe(Effect.provide(reader)),
  )

  it.effect("answers unavailable before any writer created the tables, and creates none", () =>
    Effect.gen(function* () {
      const error = yield* (yield* Papers).read(bibliography().id).pipe(Effect.flip)

      expect(error).toBeInstanceOf(PapersUnavailable)
      expect(yield* created).toEqual([])
    }).pipe(Effect.provide(reader)),
  )
})

describe("the paper store's tables", () => {
  it.effect("refuse a version of a copy that is not admitted", () =>
    Effect.gen(function* () {
      const { copy, version } = yield* publish().pipe(Effect.provide(papersDb))

      // A copy keeps its admission while it has a version.
      expect(
        yield* refused((sql) => sql`UPDATE copy SET admission = 'Restricted' WHERE id = ${copy}`),
      ).toContain("FOREIGN KEY constraint failed")

      // A copy whose licence was not admitted gets no version.
      const restricted = yield* refused((sql) =>
        sql`INSERT INTO copy (id, paper, location, evidence, admission)
          SELECT ${"9".repeat(64)}, paper, location, '[]', 'Restricted' FROM copy WHERE id = ${copy}`.pipe(
          Effect.andThen(
            sql`INSERT INTO version (id, paper, copy, extraction, url, pdf, text, pages, empty_pages)
              SELECT ${"8".repeat(64)}, paper, ${"9".repeat(64)}, extraction, url, pdf, text, pages,
                empty_pages
              FROM version WHERE id = ${version}`,
          ),
        ),
      )

      expect(restricted).toContain("FOREIGN KEY constraint failed")
    }),
  )

  it.effect("refuse an active version of another paper", () =>
    Effect.gen(function* () {
      const { version } = yield* publish().pipe(Effect.provide(papersDb))

      const listed = yield* list({ paper: bibliography({ id: other }) }).pipe(
        Effect.provide(papersDb),
      )

      expect(
        yield* refused(
          (sql) => sql`UPDATE paper SET reason = NULL, active = ${version} WHERE id = ${listed}`,
        ),
      ).toContain("FOREIGN KEY constraint failed")
    }),
  )
})
