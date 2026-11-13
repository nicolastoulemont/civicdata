import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import { NodeFileSystem } from "@effect/platform-node"
import { Config, Effect, Layer, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { FetchHttpClient } from "effect/http"

import { Annotator } from "../src/research/Annotator.ts"
import { Question, questionOf, search } from "../src/research/search.ts"
import { benchmark, Sample, Questions } from "./papers/benchmark.ts"
import { Retrieval } from "./papers/retrieval.ts"
import { Papers } from "./papers/storage.ts"

const { values } = parseArgs({
  options: {
    corpus: {
      type: "string",
      default: fileURLToPath(new URL("../../../.papers/corpus-v4", import.meta.url)),
    },
    annotate: { type: "boolean", default: false },
    check: { type: "boolean", default: false },
    query: { type: "string" },
    country: { type: "string", multiple: true },
    from: { type: "string" },
    to: { type: "string" },
    cause: { type: "boolean", default: false },
  },
})

if (Number(values.annotate) + Number(values.check) + Number(values.query !== undefined) !== 1)
  throw new Error("Choose --annotate, --check or --query <text>")

if ((values.from === undefined) !== (values.to === undefined))
  throw new Error("Supply both --from and --to")

const files = Retrieval.files(values.corpus).pipe(
  Layer.provide(Papers.files(values.corpus)),
  Layer.provide(NodeFileSystem.layer),
)

const remote = Layer.unwrap(
  Effect.gen(function* () {
    const apiKey = yield* Config.Redacted("OPENAI_API_KEY")

    return Annotator.openAi(apiKey).pipe(Layer.provide(FetchHttpClient.layer))
  }),
)

const annotate = Effect.gen(function* () {
  const corpus = yield* Retrieval
  const papers = yield* corpus.documents
  const entries = yield* Effect.forEach(papers, (paper) => corpus.annotate(paper))
  console.log(
    JSON.stringify(
      entries.map(({ paper, annotation }) => ({
        title: paper.seed.study.title,
        passages: annotation.labels.length,
        categories: Object.fromEntries(
          [...new Set(annotation.labels.map(({ category }) => category))].map((category) => [
            category,
            annotation.labels.filter((label) => label.category === category).length,
          ]),
        ),
        scope: annotation.scope,
      })),
      null,
      2,
    ),
  )
})

const inferred = values.query === undefined ? undefined : questionOf(values.query)

const input = {
  text: values.query,
  countries: values.country ?? inferred?.countries,
  period:
    values.from === undefined
      ? inferred?.period
      : { from: Number(values.from), to: Number(values.to) },
  intent: values.cause ? "Cause" : inferred?.intent,
}

const query = Effect.gen(function* () {
  const question = yield* Schema.decodeUnknownEffect(Question)(input)
  const entries = yield* (yield* Retrieval).entries

  console.log(JSON.stringify(search(entries, { question }), null, 2))
})

const check = Effect.gen(function* () {
  const entries = yield* (yield* Retrieval).entries
  const fs = yield* FileSystem

  const directory = fileURLToPath(
    new URL("../../../docs/research/papers/expanded", import.meta.url),
  )

  const sample = yield* fs
    .readFileString(`${directory}/labels.json`)
    .pipe(Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Sample))))

  const questions = yield* fs
    .readFileString(`${directory}/questions.json`)
    .pipe(Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Questions))))

  const report = benchmark(entries, { sample, questions })

  console.log(JSON.stringify(report, null, 2))

  if (report.retrieval.correct !== report.retrieval.total || report.acceptedLabelErrors > 0)
    process.exitCode = 1
})

if (values.annotate)
  await Effect.runPromise(annotate.pipe(Effect.provide(Layer.mergeAll(files, remote))))
else if (values.check)
  await Effect.runPromise(check.pipe(Effect.provide(Layer.mergeAll(files, NodeFileSystem.layer))))
else await Effect.runPromise(query.pipe(Effect.provide(files)))
