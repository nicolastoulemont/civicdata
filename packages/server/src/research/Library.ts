import { Paper } from "@repo/domain"
import { Context, Effect, Layer, Schema } from "effect"

import { fingerprint } from "../fingerprint.ts"
import { Scope, evidenceOf } from "./annotation.ts"
// The packaged corpus, bundled into the Worker until the paper store replaces
// it: NTO-228 deletes corpus.json and this import, and reads PAPERS_DB.
import corpus from "./corpus.json" with { type: "json" }
import { Entry } from "./entry.ts"
import { Question, search } from "./search.ts"

export const Found = Schema.TaggedUnion({
  Passages: { papers: Schema.Array(Paper) },
  NoEvidence: { reason: Schema.String },
})

export class LibraryUnavailable extends Schema.TaggedError<
  LibraryUnavailable,
  { readonly brand: unique symbol }
>()("LibraryUnavailable", { cause: Schema.Unknown }) {}

interface Interface {
  readonly search: (question: Question) => Effect.Effect<typeof Found.Type, LibraryUnavailable>
}

const holding = (entries: ReadonlyArray<Entry>) =>
  Library.of({
    search: Effect.fn("Library.search")(
      function* (question: Question) {
        const result = search(entries, { question })

        if (result.status === "NoEvidence")
          return Found.cases.NoEvidence.make({ reason: result.reason })

        const papers = yield* Effect.forEach(result.matches, (match) =>
          Effect.gen(function* () {
            const { citation, passage, scope } = match
            const design = evidenceOf(scope.design)

            const context = [
              ...design.map(({ page, quote }) => ({ page, text: quote, role: "Method" as const })),
              ...match.context.map(({ page, text, category }) => ({ page, text, role: category })),
            ]

            return yield* Schema.decodeUnknownEffect(Paper)({
              id: yield* fingerprint(`${citation.content}|${passage.page}|${passage.text}`),
              study: citation.study,
              quote: passage.text,
              kind: match.category,
              design: Scope.fields.design.match(scope.design, {
                Unknown: () => "Unknown",
                Description: () => "Description",
                Association: () => "Association",
                AuthorCausalEstimate: () => "AuthorCausalEstimate",
              }),
              population: scope.population?.quote ?? null,
              countries: scope.countries.map(({ code }) => code),
              periods: scope.periods.map(({ from, to }) => ({ from, to })),
              page: citation.page,
              url: citation.url,
              sha256: citation.sha256,
              version: citation.providerVersion,
              licences: [...new Set(citation.licences.map(({ licence }) => licence))],
              context: [
                ...new Map(context.map((item) => [`${item.page}|${item.text}`, item])).values(),
              ],
            })
          }),
        )

        return Found.cases.Passages.make({ papers })
      },
      Effect.mapError((cause) => new LibraryUnavailable({ cause })),
    ),
  })

export class Library extends Context.Service<Library, Interface>()("research/Library") {
  static readonly layer = Layer.effect(
    Library,
    Schema.decodeUnknownEffect(Schema.Array(Entry))(corpus).pipe(Effect.map(holding), Effect.orDie),
  )
  static readonly holding = (entries: ReadonlyArray<Entry>) =>
    Layer.succeed(Library, holding(entries))
}
