import { assert, beforeEach, describe, expect, it } from "@effect/vitest"
import { Paper } from "@repo/domain"
import { reset } from "cloudflare:test"
import { Array as Arr, Effect, Schema } from "effect"
import { SqlClient } from "effect/sql"

import run from "../../../docs/research/papers/corpus-run.json"
import corpus from "../src/research/corpus.json"
import { Discovery, listsReferences, Match, QueryInvalid } from "../src/research/Discovery.ts"
import { Entry } from "../src/research/entry.ts"
import { PapersUnavailable } from "../src/research/Papers.ts"
import { PaperId, tables } from "../src/research/store.ts"
import { bibliography, body, list, papersDb, publish, withdraw } from "./papers.ts"

// Search as the Worker builds it, over its PAPERS_DB binding.
const searcher = Discovery.layer

beforeEach(() => reset())

const idOf = (n: number) => PaperId.make(n.toString(16).padStart(64, "0"))

// A paper with this id and title, valid otherwise.
const titled = (n: number, title: string) =>
  bibliography({ id: idOf(n), study: { ...bibliography().study, title } })

const search = (query: string) =>
  Effect.gen(function* () {
    return yield* (yield* Discovery).search(query)
  })

// A match the store holds text for.
const textOf = (match: Match | undefined) => {
  assert(match !== undefined && Match.guards.Text(match), "Expected a match with text")

  return match
}

const references =
  "References Bossler, M. and Broszeit, S., 2017. Do minimum wages increase job satisfaction? Labour, 31(4), pp.480-493. Card, D. and Krueger, A. (1994). Minimum wages and employment: a case study. American Economic Review, 84(4), pp.772-793. Dube, A. (2019). Impacts of minimum wages. London: HM Treasury."

describe("paper search", () => {
  it.effect("finds a newly published, unannotated paper by its title and its text", () =>
    Effect.gen(function* () {
      const { paper, version, copy } = yield* publish({
        paper: titled(1, "Pensions and retirement in Germany"),
        passages: [
          {
            page: 2,
            part: 0,
            text: "Disability pensions let workers retire before the statutory age.",
          },
          { page: 7, part: 1, text: "We calibrate the model to German household survey data." },
        ],
        annotation: null,
      }).pipe(Effect.provide(papersDb))

      // The title and a passage share "retire", which the index stems.
      const byTitle = textOf((yield* search("retirement in Germany"))[0])

      expect(byTitle.paper.id).toBe(paper)
      expect(byTitle.copy.id).toBe(copy)
      expect(byTitle.version.id).toBe(version)
      expect(byTitle.annotated).toBe(false)
      expect(byTitle.excerpts).toEqual([
        {
          page: 2,
          part: 0,
          text: "Disability pensions let workers retire before the statutory age.",
        },
      ])

      const byText = textOf((yield* search("household survey"))[0])

      expect(byText.excerpts.map(({ page, part }) => [page, part])).toEqual([[7, 1]])
    }).pipe(Effect.provide(searcher)),
  )

  it.effect("says whether the version has an annotation", () =>
    Effect.gen(function* () {
      yield* publish({ annotation: body() }).pipe(Effect.provide(papersDb))

      expect(textOf((yield* search("training"))[0]).annotated).toBe(true)
    }).pipe(Effect.provide(searcher)),
  )

  it.effect("finds a metadata-only record by its title, without a passage", () =>
    Effect.gen(function* () {
      yield* list({ paper: titled(1, "Carbon taxes and emissions in Sweden") }).pipe(
        Effect.provide(papersDb),
      )

      expect(yield* search("Swedish carbon tax")).toEqual([
        Match.cases.Metadata.make({
          paper: titled(1, "Carbon taxes and emissions in Sweden"),
          reason: "no-licensed-pdf",
        }),
      ])
    }).pipe(Effect.provide(searcher)),
  )

  it.effect("ranks a paper whose title and text match above one that mentions the words", () =>
    Effect.gen(function* () {
      yield* publish({
        paper: titled(1, "Public debt in Japan"),
        passages: [
          { page: 3, part: 0, text: "Among other policies, the minimum wage rose in 2019." },
        ],
      }).pipe(Effect.provide(papersDb))

      yield* publish({
        paper: titled(2, "Minimum wage employment in Ireland"),
        passages: [{ page: 5, part: 0, text: "Minimum wage vacancies grew fastest in Dublin." }],
      }).pipe(Effect.provide(papersDb))

      const found = yield* search("minimum wage")

      expect(found.map(({ paper }) => paper.id)).toEqual([idOf(2), idOf(1)])
    }).pipe(Effect.provide(searcher)),
  )

  it.effect("groups passages by paper: ten papers at most, three passages each", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(
        Array.from({ length: 12 }, (_, n) => n + 1),
        (n) =>
          publish({
            paper: titled(n, `Study ${n}`),
            passages: Arr.makeBy(5, (page) => ({
              page: page + 1,
              part: 0,
              text: `Youth unemployment on page ${page + 1} of study ${n}.`,
            })),
          }),
        { discard: true },
      ).pipe(Effect.provide(papersDb))

      const found = (yield* search("youth unemployment")).map(textOf)

      expect(found).toHaveLength(10)
      expect(new Set(found.map(({ paper }) => paper.id)).size).toBe(10)
      expect(found.every(({ excerpts }) => excerpts.length === 3)).toBe(true)
    }).pipe(Effect.provide(searcher)),
  )

  it.effect("leaves out a paper that matches only in its reference list", () =>
    Effect.gen(function* () {
      yield* publish({
        paper: titled(1, "Fiscal consolidation in Spanish regions"),
        passages: [
          { page: 4, part: 0, text: "Regional deficits rose after 2008 across Spain." },
          { page: 19, part: 0, text: references },
        ],
      }).pipe(Effect.provide(papersDb))

      yield* publish({
        paper: titled(2, "Wages and work in Ireland"),
        passages: [{ page: 6, part: 0, text: "Minimum wage jobs ask for less experience." }],
      }).pipe(Effect.provide(papersDb))

      const found = (yield* search("minimum wages employment")).map(textOf)

      expect(found.map(({ paper }) => paper.id)).toEqual([idOf(2)])
    }).pipe(Effect.provide(searcher)),
  )

  it.effect("finds nothing for text no paper holds, a withdrawn copy or an unfinished one", () =>
    Effect.gen(function* () {
      yield* publish().pipe(Effect.provide(papersDb))
      yield* withdraw({ paper: titled(2, "Housing prices in Portugal") }).pipe(
        Effect.provide(papersDb),
      )

      expect(yield* search("pension reform")).toEqual([])
      expect(yield* search("housing Portugal")).toEqual([])

      // A writer that stopped before setting the active version.
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient

        yield* sql`UPDATE paper SET active = NULL`
      }).pipe(Effect.provide(papersDb))

      expect(yield* search("training")).toEqual([])
    }).pipe(Effect.provide(searcher)),
  )

  it.effect("drops a version's passages from the index when a writer withdraws its copy", () =>
    Effect.gen(function* () {
      const { paper, copy, version } = yield* publish().pipe(Effect.provide(papersDb))

      // The withdrawal order docs/papers.md gives, then what the index holds
      // for the version.
      const indexed = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient

        yield* sql`UPDATE paper SET active = NULL WHERE id = ${paper}`
        yield* sql`DELETE FROM version WHERE id = ${version}`
        yield* sql`UPDATE copy SET admission = 'Withdrawn', withdrawal = 'Rights' WHERE id = ${copy}`

        return yield* sql`SELECT page FROM search WHERE search MATCH ${`version : "${version}"`}`
      }).pipe(Effect.provide(papersDb))

      expect(indexed).toEqual([])
      expect(yield* search("training participation")).toEqual([])
    }).pipe(Effect.provide(searcher)),
  )

  it.effect("indexes a store written before the index existed, once a writer runs tables", () =>
    Effect.gen(function* () {
      yield* publish().pipe(Effect.provide(papersDb))

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient

        const triggers = yield* sql<{
          readonly name: string
        }>`SELECT name FROM sqlite_master WHERE type = 'trigger'`

        yield* Effect.forEach(triggers, ({ name }) => sql`DROP TRIGGER ${sql(name)}`, {
          discard: true,
        })
        yield* sql`DROP TABLE search`
        yield* tables
      }).pipe(Effect.provide(papersDb))

      expect(textOf((yield* search("training"))[0]).excerpts).toHaveLength(2)
    }).pipe(Effect.provide(searcher)),
  )

  it.effect("keeps a corrected title searchable under its new words only", () =>
    Effect.gen(function* () {
      const paper = yield* list().pipe(Effect.provide(papersDb))

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient

        yield* sql`UPDATE paper SET study = json_set(study, '$.title', 'Apprenticeships in Austria')
          WHERE id = ${paper}`
      }).pipe(Effect.provide(papersDb))

      expect(yield* search("training France")).toEqual([])
      expect((yield* search("apprenticeships")).map((match) => match.paper.id)).toEqual([paper])
    }).pipe(Effect.provide(searcher)),
  )

  it.effect("refuses a query without words to search, or one too long", () =>
    Effect.gen(function* () {
      yield* tables.pipe(Effect.provide(papersDb))

      expect(yield* search("  ?! the of and ").pipe(Effect.flip)).toEqual(
        new QueryInvalid({ reason: "Empty" }),
      )
      expect(yield* search("wage ".repeat(300)).pipe(Effect.flip)).toEqual(
        new QueryInvalid({ reason: "Long" }),
      )
      expect(
        yield* search(Array.from({ length: 17 }, (_, n) => `word${n}`).join(" ")).pipe(Effect.flip),
      ).toEqual(new QueryInvalid({ reason: "Long" }))
    }).pipe(Effect.provide(searcher)),
  )

  it.effect("reads FTS5 syntax in a query as words", () =>
    Effect.gen(function* () {
      const { version } = yield* publish().pipe(Effect.provide(papersDb))

      expect(yield* search(`version:${version}`)).toEqual([])
      expect(yield* search(`"training" NEAR(employ* France) OR {title}: -`)).toHaveLength(1)
    }).pipe(Effect.provide(searcher)),
  )

  it.effect("returns matches that do not decode as a citable paper", () =>
    Effect.gen(function* () {
      yield* publish().pipe(Effect.provide(papersDb))

      const [match] = yield* search("training")

      expect(Schema.is(Paper)(match)).toBe(false)
    }).pipe(Effect.provide(searcher)),
  )

  it.effect("answers unavailable before any writer created the tables, and creates none", () =>
    Effect.gen(function* () {
      expect(yield* search("training").pipe(Effect.flip)).toBeInstanceOf(PapersUnavailable)

      const created = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient

        return yield* sql`SELECT name FROM sqlite_master WHERE name NOT LIKE '\\_cf\\_%' ESCAPE '\\'`
      }).pipe(Effect.provide(papersDb))

      expect(created).toEqual([])
    }).pipe(Effect.provide(searcher)),
  )
})

// A reproducible sample: the eight papers corpus.json packages, unannotated,
// and the metadata of the other 93 records the corpus run discovered, many
// of them about the same topics. Each query names the papers a reader who
// knows the corpus would want first. A match only says the words are there,
// never that the paper supports anything.
describe("paper search on the packaged sample", () => {
  const entries = corpus.map((entry) => Schema.decodeUnknownSync(Entry)(entry))
  const held = new Set(entries.map(({ paper }) => paper.seed.id))

  const fill = Effect.gen(function* () {
    yield* Effect.forEach(
      entries,
      ({ paper }) =>
        publish({
          paper: bibliography({
            id: PaperId.make(paper.seed.id),
            openalex: paper.seed.openalex,
            study: paper.seed.study,
            metadataUrl: paper.metadataUrl,
            retrievedAt: paper.retrievedAt,
          }),
          passages: paper.content.passages,
          annotation: null,
        }),
      { discard: true },
    )

    yield* Effect.forEach(
      run.results.filter(({ id }) => !held.has(id)),
      (record) =>
        list({
          paper: bibliography({
            id: PaperId.make(record.id),
            openalex: record.work?.id ?? null,
            study: {
              authors: record.authors,
              year: record.work?.publication_year ?? 2000,
              title: record.title,
              publisher: null,
              doi: null,
              url: record.metadataUrl,
            },
            metadataUrl: record.metadataUrl,
            retrievedAt: record.retrievedAt,
          }),
        }),
      { discard: true },
    )
  }).pipe(Effect.provide(papersDb))

  const wanted: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    ["minimum wage incidence Ireland", ["044ad0", "424e4d"]],
    ["minimum wage job satisfaction", ["044ad0"]],
    ["online vacancies Ireland skills", ["424e4d"]],
    ["minimum wage experience requirements", ["424e4d"]],
    ["democracy economic growth Indonesia", ["fd9932"]],
    ["democracy income inequality Indonesia", ["fd9932"]],
    ["causal carbon tax emissions Britain", ["2ac931"]],
    ["fiscal multiplier biases", ["cf6328"]],
    ["fiscal consolidation economic growth Spain", ["c4b61d"]],
    ["disability pensions retirement Germany", ["089037"]],
    ["minimum wage growth EU member states", ["760090"]],
    // A metadata-only record.
    ["reallocation effects of the minimum wage", ["09b38f"]],
  ]

  it.effect("ranks each query's wanted papers in its first two", () =>
    Effect.gen(function* () {
      yield* fill

      const discovery = yield* Discovery

      const firsts = yield* Effect.forEach(wanted, ([query]) =>
        discovery
          .search(query)
          .pipe(Effect.map((found) => found.slice(0, 2).map(({ paper }) => paper.id.slice(0, 6)))),
      )

      expect(firsts.map((ids, n) => wanted[n]?.[1].every((id) => ids.includes(id)))).toEqual(
        wanted.map(() => true),
      )
    }).pipe(Effect.provide(searcher)),
  )

  it("tells most reference passages from the rest", () => {
    const flagged = entries.flatMap(({ paper, annotation }) => {
      const labelled = new Set(
        annotation.labels.flatMap(({ page, part, category }) =>
          category === "Reference" ? [`${page}/${part}`] : [],
        ),
      )

      return paper.content.passages.flatMap(({ page, part, text }) =>
        listsReferences(text) ? [labelled.has(`${page}/${part}`)] : [],
      )
    })

    // Of 42 passages labelled as references and 460 others.
    expect(flagged.filter((reference) => reference)).toHaveLength(34)
    expect(flagged.filter((reference) => !reference)).toHaveLength(6)
  })
})
