import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import { expect, it } from "@effect/vitest"
import { Effect, Layer, Redacted, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

import { ResearchUnavailable, Scope } from "../../src/research/annotation.schemas.ts"
import { AnnotationInvalid } from "../../src/research/Annotator.schemas.ts"
import { Annotator } from "../../src/research/Annotator.ts"
import { model } from "../../src/research/constants/model.ts"
import { Question } from "../../src/research/search.schemas.ts"
import { grounded } from "../../src/research/utils/grounded.ts"
import { questionOf } from "../../src/research/utils/questionOf.ts"
import { search } from "../../src/research/utils/search.ts"
import { Retrieval } from "./retrieval.ts"
import { recorded, saved, seed } from "./testing.ts"

const anchor = { page: 1, quote: "Employment rose in France." }

const scope = Scope.make({
  population: null,
  excerpts: [anchor],
  countries: [{ code: "FRA", evidence: anchor }],
  regions: [],
  periods: [],
  design: Scope.fields.design.cases.Description.make({ evidence: anchor }),
})

const labels = [
  { type: "choice", name: "1:0", choice: "Description", confidence: 0.99 },
  { type: "choice", name: "2:0", choice: "Limitation", confidence: 0.99 },
  { type: "choice", name: "result:0", choice: "Description", confidence: 0.99 },
]

// Real SDK and HTTP adapter, intercepted below both clients.
const provider = () => {
  const requests: Array<string> = []
  const state = { up: true, scope, answers: labels, reference: { page: 1, part: 0, sentence: 0 } }

  const http = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      requests.push(request.url)

      const response =
        !state.up && request.url.endsWith("/decisions")
          ? new Response("unavailable", { status: 503 })
          : request.url.endsWith("/decisions")
            ? Response.json({ answers: state.answers })
            : Response.json({
                id: "test",
                created_at: 0,
                model,
                output: [
                  {
                    id: "message",
                    type: "message",
                    role: "assistant",
                    status: "completed",
                    content: [
                      {
                        type: "output_text",
                        text: JSON.stringify({
                          ...state.scope,
                          excerpts: [state.reference],
                          countries: state.scope.countries.map(({ code }) => ({
                            code,
                            evidence: state.reference,
                          })),
                          design: { ...state.scope.design, evidence: state.reference },
                        }),
                        annotations: [],
                      },
                    ],
                  },
                ],
              })

      return Effect.succeed(HttpClientResponse.fromWeb(request, response))
    }),
  )

  const apiKey = Redacted.make("test")

  return {
    requests,
    state,
    layer: Annotator.layer(apiKey).pipe(
      Layer.provide(OpenAiLanguageModel.model(model)),
      Layer.provide(OpenAiClient.layer({ apiKey })),
      Layer.provide(http),
    ),
  }
}

it.effect(
  "annotates, resumes without model calls, and searches with original text and a page citation",
  () => {
    const world = recorded()
    const remote = provider()

    const layer = Layer.mergeAll(
      world.layer,
      Retrieval.files("/papers").pipe(Layer.provide(world.layer)),
      remote.layer,
    )

    return Effect.gen(function* () {
      yield* saved
      const corpus = yield* Retrieval
      const docs = yield* corpus.documents
      const paper = docs[0]

      if (paper === undefined) throw new Error("Missing fixture")
      const entry = yield* corpus.annotate(paper)
      expect(remote.requests).toHaveLength(2)
      expect((yield* corpus.annotate(paper)).annotation).toEqual(entry.annotation)
      expect(remote.requests).toHaveLength(2)

      const result = search(yield* corpus.entries, {
        question: questionOf("Employment rose France"),
      })

      expect(result.status).toBe("Passages")
      expect(result.matches?.[0]).toMatchObject({
        category: "Description",
        passage: { page: 1, text: paper.content.passages[0].text },
        citation: {
          page: 1,
          sha256: paper.content.sha256,
          providerVersion: "publishedVersion",
          url: "https://example.org/paper.pdf#page=1",
        },
        context: [{ page: 2, category: "Limitation" }],
      })

      for (const text of [
        "Employment Germany",
        "Employment France 2050",
        "causal effect employment France",
        "fiscal multipliers austerity",
        "Employment France zebra",
      ]) {
        expect(search([entry], { question: questionOf(text) }).status).toBe("NoEvidence")
      }

      expect(world.requests).toEqual([])
    }).pipe(Effect.provide(layer))
  },
)

it.effect(
  "keeps successful scope when classification fails and retries only classification",
  () => {
    const world = recorded()
    const remote = provider()
    remote.state.up = false

    return Effect.gen(function* () {
      yield* saved
      const corpus = yield* Retrieval
      const paper = (yield* corpus.documents)[0]

      if (paper === undefined) throw new Error("Missing fixture")
      expect(yield* corpus.annotate(paper).pipe(Effect.flip)).toBeInstanceOf(ResearchUnavailable)
      expect(yield* corpus.entries.pipe(Effect.flip)).toBeInstanceOf(ResearchUnavailable)
      remote.state.up = true
      yield* corpus.annotate(paper)
      expect(remote.requests.filter((url) => url.endsWith("/responses"))).toHaveLength(1)
      expect(remote.requests.filter((url) => url.endsWith("/decisions"))).toHaveLength(2)
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          world.layer,
          Retrieval.files("/papers").pipe(Layer.provide(world.layer)),
          remote.layer,
        ),
      ),
    )
  },
)

it.effect(
  "rejects unknown evidence sentences, missing and duplicate classifications at the provider seam",
  () => {
    const remote = provider()

    return Effect.gen(function* () {
      const annotator = yield* Annotator

      const passages = [
        { page: 1, part: 0, text: "Employment rose in France." },
        { page: 2, part: 0, text: "The estimate is uncertain." },
      ]

      remote.state.reference = { page: 99, part: 0, sentence: 0 }
      expect(yield* annotator.scope(passages).pipe(Effect.flip)).toBeInstanceOf(AnnotationInvalid)

      for (const answers of [
        [],
        [labels[0], labels[0]].flatMap((row) => (row === undefined ? [] : [row])),
        [{ type: "choice", name: "99:0", choice: "Description", confidence: 0.99 }],
        [{ type: "refusal", name: "1:0", choice: "Description", confidence: 0.99 }],
      ]) {
        remote.state.answers = answers
        expect(
          yield* annotator.labels(passages, { excerpts: scope.excerpts }).pipe(Effect.flip),
        ).toBeInstanceOf(AnnotationInvalid)
      }
    }).pipe(Effect.provide(remote.layer))
  },
)

it.effect(
  "rejects corrupt annotations and altered PDF snapshots instead of returning no evidence",
  () => {
    const world = recorded()
    const remote = provider()

    return Effect.gen(function* () {
      yield* saved
      const corpus = yield* Retrieval
      const paper = (yield* corpus.documents)[0]

      if (paper === undefined) throw new Error("Missing fixture")
      const entry = yield* corpus.annotate(paper)

      const annotation = [...world.files.keys()].find(
        (path) => path.includes("/annotations/") && !path.includes("scope"),
      )

      if (annotation === undefined) throw new Error("Missing annotation")
      world.files.set(
        annotation,
        JSON.stringify({
          scope: entry.annotation.scope,
          labels: entry.annotation.labels,
          excerpts: entry.annotation.excerpts,
          stamp: { ...entry.annotation.stamp, input: "b".repeat(64) },
        }),
      )
      expect(yield* corpus.entries.pipe(Effect.flip)).toBeInstanceOf(ResearchUnavailable)
      world.files.set(annotation, "{}")
      expect(yield* corpus.entries.pipe(Effect.flip)).toBeInstanceOf(ResearchUnavailable)
      world.snapshots.set(`/papers/${seed.id}-${paper.content.sha256}.pdf`, new Uint8Array([1]))
      expect(yield* corpus.documents.pipe(Effect.flip)).toBeInstanceOf(ResearchUnavailable)
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          world.layer,
          Retrieval.files("/papers").pipe(Layer.provide(world.layer)),
          remote.layer,
        ),
      ),
    )
  },
)

it("requires period endpoints on the cited page", () => {
  expect(
    grounded({ ...scope, periods: [{ from: 2010, to: 2020, evidence: anchor }] }, [
      { ...anchor, part: 0, text: anchor.quote },
    ]),
  ).toBe(false)
})

it.effect("decodes invalid query periods before searching", () =>
  Effect.gen(function* () {
    const question = questionOf("minimum wage Ireland")

    for (const period of [
      { from: 2020, to: 2010 },
      { from: Number.NaN, to: 2020 },
      { from: 1700, to: 2020 },
    ]) {
      expect(
        yield* Schema.decodeUnknownEffect(Question)({
          text: question.text,
          countries: question.countries,
          intent: question.intent,
          period,
        }).pipe(Effect.isFailure),
      ).toBe(true)
    }
  }),
)
