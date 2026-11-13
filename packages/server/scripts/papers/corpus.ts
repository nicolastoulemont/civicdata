// A gathered corpus directory, as the publication command reads it: one
// record per paper, the PDF of each retained copy, and saved annotations.
import { Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"

import { Annotation } from "../../src/research/annotation.ts"
import { Content, Paper } from "../../src/research/archive.ts"
import { Document } from "../../src/research/entry.ts"
import { Record } from "../../src/research/publication.ts"
import { fingerprint } from "../../src/utils/fingerprint.ts"
import { fits, inputOf } from "./retrieval.ts"

// A record that does not decode, does not match its file name or copy
// identity, or whose PDF is missing or has another hash.
export class CorpusInvalid extends Schema.TaggedError<
  CorpusInvalid,
  { readonly brand: unique symbol }
>()("CorpusInvalid", { file: Schema.String, problem: Schema.String }) {}

const PaperJson = Schema.fromJsonString(Paper)
const AnnotationJson = Schema.fromJsonString(Annotation)

// The paper records a corpus directory holds, by file name.
export const records = Effect.fn("Corpus.records")(function* (directory: string) {
  const fs = yield* FileSystem

  const names = yield* fs
    .readDirectory(directory)
    .pipe(
      Effect.mapError(({ message }) => new CorpusInvalid({ file: directory, problem: message })),
    )

  return names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).toSorted()
})

// The annotation saved for a document, or null when none is saved or the
// saved one no longer fits its record. Publication never asks a model.
const annotationOf = Effect.fnUntraced(function* (paper: Document, directory: string) {
  const fs = yield* FileSystem
  const input = yield* inputOf(paper)
  const path = `${directory}/annotations/${input}.json`

  if (!(yield* fs.exists(path))) return null

  const annotation = yield* fs
    .readFileString(path)
    .pipe(Effect.flatMap(Schema.decodeUnknownEffect(AnnotationJson)))

  return fits(annotation, { paper, input }) ? annotation : null
})

const textOf = Effect.fnUntraced(function* (paper: Paper, directory: string) {
  const fs = yield* FileSystem
  const document = yield* Schema.decodeUnknownEffect(Document)(paper)
  const { copy, id, sha256 } = document.content

  if ((yield* fingerprint(`${copy.id}|${copy.version}|${sha256}`)) !== id)
    return yield* Effect.fail("Copy id is not the hash of its location, version and PDF")

  const pdf = yield* fs.readFile(`${directory}/${paper.seed.id}-${sha256}.pdf`)

  if ((yield* fingerprint(pdf)) !== sha256) return yield* Effect.fail("PDF hash differs")

  return Record.Text({
    paper: document,
    pdf,
    annotation: yield* annotationOf(document, directory),
  })
})

// One record, checked against its file name, its copy identity and its PDF.
export const recordOf = Effect.fn("Corpus.record")(
  function* (file: string, { directory }: { readonly directory: string }) {
    const fs = yield* FileSystem

    const paper = yield* fs
      .readFileString(`${directory}/${file}`)
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(PaperJson)))

    if (file !== `${paper.seed.id}.json`) return yield* Effect.fail("File name is not the paper id")

    if (Content.guards.Metadata(paper.content)) return Record.Metadata({ paper })

    return yield* textOf(paper, directory)
  },
  (effect, file) =>
    Effect.mapError(effect, (cause) => new CorpusInvalid({ file, problem: String(cause) })),
)
