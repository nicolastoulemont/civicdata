import { assert, beforeEach, describe, expect, it } from "@effect/vitest"
import { reset } from "cloudflare:test"
import { Effect, Layer } from "effect"

import { Discovery } from "../Discovery.ts"
import { Found, Lead, Library, LibraryUnavailable } from "../Library.ts"
import { Papers } from "../Papers.ts"
import { Question } from "../search.ts"
import { PaperId } from "../store.ts"
import { annotate, bibliography, bodyOf, entry, list, papersDb, stored } from "./papers.ts"

// The lookup as the Worker builds it, over its PAPERS_DB and PAPERS bindings.
const library = Library.layer.pipe(Layer.provide(Layer.mergeAll(Discovery.layer, Papers.layer)))

beforeEach(() => reset())

const carbon = entry("2ac931")

// A question the carbon tax study answers, but for what a test changes.
const lookup = (changes: Partial<Question> = {}) =>
  Effect.flatMap(Library, (found) =>
    found.search(
      Question.make({
        text: "carbon tax emissions",
        countries: ["GBR"],
        period: null,
        intent: "Cause",
        ...changes,
      }),
    ),
  )

// The papers of a lookup that found some.
const papersOf = (found: Found) => {
  assert(Found.guards.Papers(found), `Expected papers, found ${JSON.stringify(found)}`)

  return found.papers
}

describe("research lookup", () => {
  it.effect("returns a stored annotation's passage with its methods, scope, page and licence", () =>
    Effect.gen(function* () {
      const { copy } = yield* stored(carbon).pipe(Effect.provide(papersDb))

      const [lead] = papersOf(yield* lookup())

      assert(lead !== undefined && Lead.guards.Evidence(lead), "Expected evidence")
      expect(lead.paper).toMatchObject({
        copy,
        study: { doi: "10.1016/j.eneco.2023.106655" },
        kind: "AuthorCausalEstimate",
        design: "AuthorCausalEstimate",
        countries: ["GBR"],
        licences: ["https://creativecommons.org/licenses/by/4.0/"],
      })
      expect(lead.paper.context.some(({ role }) => role === "Method")).toBe(true)
      expect(lead.paper.url).toBe(`${carbon.paper.seed.study.url}#page=${lead.paper.page}`)
    }).pipe(Effect.provide(library)),
  )

  it.effect("finds no evidence where the annotation's scope does not cover the question", () =>
    Effect.gen(function* () {
      yield* stored(carbon).pipe(Effect.provide(papersDb))

      expect(yield* lookup({ countries: ["BRA"] })).toEqual(
        Found.cases.NoEvidence.make({ reason: "scope-not-covered" }),
      )
    }).pipe(Effect.provide(library)),
  )

  it.effect("suggests unannotated papers to read, with no scope and no citation", () =>
    Effect.gen(function* () {
      const { version } = yield* stored(carbon, { annotated: false }).pipe(Effect.provide(papersDb))

      const listed = PaperId.make("e".repeat(64))

      yield* list({
        paper: bibliography({
          id: listed,
          study: { ...bibliography().study, title: "Carbon tax and emissions in Britain" },
        }),
      }).pipe(Effect.provide(papersDb))

      const papers = papersOf(yield* lookup())

      expect(papers.every(Lead.guards.Reading)).toBe(true)
      const metadata = papers.find((lead) => Lead.guards.Reading(lead) && lead.version === null)

      assert(metadata !== undefined && Lead.guards.Reading(metadata), "Expected the listed paper")
      expect(metadata.reading).toMatchObject({ id: listed, copy: null })

      const text = papers.find((lead) => Lead.guards.Reading(lead) && lead.version === version)

      assert(text !== undefined && Lead.guards.Reading(text), "Expected the paper with text")
      expect(text.reading.study.title).toBe(carbon.paper.seed.study.title)
      expect(text.reading.copy?.licences).toEqual(["https://creativecommons.org/licenses/by/4.0/"])
      expect(text.reading.copy?.excerpt?.text).toMatch(/carbon/i)
      expect(Object.keys(text.reading)).not.toContain("countries")
    }).pipe(Effect.provide(library)),
  )

  it.effect("cites a paper once its annotation is ready, with its methods and limitations", () =>
    Effect.gen(function* () {
      const { version } = yield* stored(carbon, { annotated: false }).pipe(Effect.provide(papersDb))

      const [before] = papersOf(yield* lookup())

      expect(before !== undefined && Lead.guards.Reading(before)).toBe(true)

      yield* annotate({ version, annotation: bodyOf(carbon) }).pipe(Effect.provide(papersDb))

      const [after] = papersOf(yield* lookup())

      assert(after !== undefined && Lead.guards.Evidence(after), "Expected evidence")
      expect(after.paper.context.map(({ role }) => role)).toContain("Method")
    }).pipe(Effect.provide(library)),
  )

  it.effect("fails unavailable before any writer created the store's tables", () =>
    Effect.gen(function* () {
      expect(yield* lookup().pipe(Effect.flip)).toBeInstanceOf(LibraryUnavailable)
    }).pipe(Effect.provide(library)),
  )
})
