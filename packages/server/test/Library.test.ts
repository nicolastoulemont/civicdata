import { expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

import corpus from "../src/research/corpus.json"
import { Entry } from "../src/research/entry.ts"
import { Found, Library, LibraryUnavailable } from "../src/research/Library.ts"

const source = corpus.find(({ paper }) => paper.seed.study.doi === "10.1016/j.eneco.2023.106655")

if (source === undefined) throw new Error("Missing carbon study fixture")

const entry = Schema.decodeUnknownSync(Entry)(source)

const withoutAuthors = Schema.decodeUnknownSync(Entry)({
  ...source,
  paper: {
    ...source.paper,
    seed: { ...source.paper.seed, study: { ...source.paper.seed.study, authors: [] } },
  },
})

const question = {
  text: "carbon tax emissions",
  countries: ["GBR"],
  period: null,
  intent: "Cause",
} as const

it.effect("returns original results with methods, scope, page and reuse attribution", () =>
  Effect.gen(function* () {
    const library = yield* Library
    const found = yield* library.search(question)
    expect(Found.guards.Passages(found)).toBe(true)

    if (!Found.guards.Passages(found)) throw new Error("Missing expected paper")
    expect(found.papers[0]).toMatchObject({
      study: { doi: source.paper.seed.study.doi },
      kind: "AuthorCausalEstimate",
      design: "AuthorCausalEstimate",
      licences: ["https://creativecommons.org/licenses/by/4.0/"],
    })
    expect(found.papers[0]?.context.some(({ role }) => role === "Method")).toBe(true)
    const empty = yield* library.search({ ...question, countries: ["BRA"] })
    expect(Found.guards.NoEvidence(empty)).toBe(true)
  }).pipe(Effect.provide(Library.holding([entry]))),
)

it.effect("keeps malformed citation metadata in the typed failure channel", () =>
  Effect.gen(function* () {
    const library = yield* Library
    expect(yield* library.search(question).pipe(Effect.flip)).toBeInstanceOf(LibraryUnavailable)
  }).pipe(Effect.provide(Library.holding([withoutAuthors]))),
)
