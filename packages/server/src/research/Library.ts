import { Paper, Reading } from "@repo/domain"
import { Array as Arr, Context, Effect, Layer, Option, Schema } from "effect"

import { fingerprint } from "../fingerprint.ts"
import { Scope, evidenceOf } from "./annotation.ts"
import { Discovery, Match, type QueryInvalid } from "./Discovery.ts"
import { Held, Papers } from "./Papers.ts"
import { type Annotated, Question, search } from "./search.ts"
import { Version } from "./store.ts"

// What a lookup found of one paper. Evidence is a passage of the version's
// active annotation, as the domain's Paper, which an answer may cite once
// Support accepts the sentence. A Reading is a paper search found that no
// annotation covers: its domain Reading, shown under the answer and never
// cited, and the version a demand records, or null for a paper the store
// holds only the bibliography of. An annotated paper whose annotation gives
// no passage for the question is neither.
export const Lead = Schema.TaggedUnion({
  Evidence: { paper: Paper },
  Reading: { reading: Reading, version: Schema.NullOr(Version.fields.id) },
})

// The leads of a lookup in search's order, or why it found none.
export const Found = Schema.TaggedUnion({
  Papers: { papers: Schema.NonEmptyArray(Lead) },
  NoEvidence: { reason: Schema.String },
})

export type Found = typeof Found.Type

// The paper store could not answer, or holds a paper whose citation does
// not decode.
export class LibraryUnavailable extends Schema.TaggedError<
  LibraryUnavailable,
  { readonly brand: unique symbol }
>()("LibraryUnavailable", { cause: Schema.Unknown }) {}

interface Interface {
  readonly search: (question: Question) => Effect.Effect<Found, QueryInvalid | LibraryUnavailable>
}

// A paper the store holds with text, as search reads an annotated one.
const annotatedOf = (held: typeof Held.cases.Text.Type, annotation: Annotated["annotation"]) => ({
  paper: {
    seed: { id: held.paper.id, study: held.paper.study },
    content: {
      id: held.copy.id,
      copy: held.copy.location,
      sha256: held.version.pdf,
      url: held.version.url,
      evidence: held.copy.evidence,
      passages: held.passages,
    },
  },
  annotation,
})

// A match no annotation covers, as the person reads it: its bibliography,
// and for an admitted copy its PDF, its reuse licences and the best passage
// the words found. A copy with no licence evidence is shown without one.
const readingOf = (match: Match) =>
  Match.match(match, {
    Metadata: ({ paper }) =>
      Lead.cases.Reading.make({
        reading: { id: paper.id, study: paper.study, copy: null },
        version: null,
      }),
    Text: ({ paper, copy, version, excerpts }) => {
      const licences = [...new Set(copy.evidence.map(({ licence }) => licence))]
      const [excerpt] = excerpts

      return Lead.cases.Reading.make({
        reading: {
          id: paper.id,
          study: paper.study,
          copy: Arr.isReadonlyArrayNonEmpty(licences)
            ? {
                url: excerpt === undefined ? version.url : `${version.url}#page=${excerpt.page}`,
                licences,
                excerpt: excerpt === undefined ? null : { page: excerpt.page, text: excerpt.text },
              }
            : null,
        },
        version: version.id,
      })
    },
  })

export class Library extends Context.Service<Library, Interface>()("research/Library") {
  // Needs Discovery and Papers. Reads the paper store only: it records no
  // demand, starts no Workflow and calls no model.
  static readonly layer = Layer.effect(
    Library,
    Effect.gen(function* () {
      const discovery = yield* Discovery
      const papers = yield* Papers

      // The text and active annotation of a match search found annotated.
      // A paper withdrawn, unpublished or unannotated since the search, or
      // whose text object fails its hash, is left out; a store that cannot
      // answer fails the lookup.
      const annotated = (match: typeof Match.cases.Text.Type) =>
        papers.read(match.paper.id).pipe(
          Effect.map((held) =>
            Held.guards.Text(held) && held.annotation !== null
              ? Option.some(annotatedOf(held, held.annotation))
              : Option.none(),
          ),
          Effect.catchTags({
            PaperMissing: () => Effect.succeedNone,
            PaperCorrupt: (error) =>
              Effect.logWarning("A matched paper's text is corrupt", error).pipe(
                Effect.as(Option.none()),
              ),
          }),
        )

      const lookup = Effect.fn("Library.search")(
        function* (question: Question) {
          const matches = yield* discovery.search(question.text)

          const held = yield* Effect.forEach(
            matches.filter(
              (match): match is typeof Match.cases.Text.Type =>
                Match.guards.Text(match) && match.annotated,
            ),
            annotated,
            { concurrency: 4 },
          )

          const result = search(Arr.getSomes(held), { question })

          const evidence = new Map<string, Paper>()

          if (result.status === "Passages") {
            for (const { citation, passage, scope, category, context } of result.matches) {
              evidence.set(
                citation.paper,
                yield* Schema.decodeUnknownEffect(Paper)({
                  id: yield* fingerprint(`${citation.content}|${passage.page}|${passage.text}`),
                  copy: citation.content,
                  study: citation.study,
                  quote: passage.text,
                  kind: category,
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
                    ...new Map(
                      [
                        ...evidenceOf(scope.design).map(({ page, quote }) => ({
                          page,
                          text: quote,
                          role: "Method" as const,
                        })),
                        ...context.map(({ page, text, category: role }) => ({ page, text, role })),
                      ].map((item) => [`${item.page}|${item.text}`, item]),
                    ).values(),
                  ],
                }),
              )
            }
          }

          // In search's order: evidence where the annotation gives a
          // passage, a reading where there is no annotation.
          const leads = matches.flatMap((match): ReadonlyArray<typeof Lead.Type> => {
            const paper = evidence.get(match.paper.id)

            if (paper !== undefined) return [Lead.cases.Evidence.make({ paper })]

            return Match.guards.Text(match) && match.annotated ? [] : [readingOf(match)]
          })

          if (Arr.isReadonlyArrayNonEmpty(leads)) return Found.cases.Papers.make({ papers: leads })

          return Found.cases.NoEvidence.make({
            reason:
              matches.length === 0 || result.status === "Passages"
                ? "no-matching-paper"
                : result.reason,
          })
        },
        Effect.catchTags({
          PapersUnavailable: (cause) => Effect.fail(new LibraryUnavailable({ cause })),
          SchemaError: (cause) => Effect.fail(new LibraryUnavailable({ cause })),
        }),
      )

      return Library.of({ search: lookup })
    }),
  )
}
