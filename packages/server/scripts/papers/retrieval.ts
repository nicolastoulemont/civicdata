import { Clock, Context, Effect, Layer, Option, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"

import {
  Annotation,
  complete,
  grounded,
  excerptsComplete,
  model,
  ResearchUnavailable,
  rubric,
  Scope,
  Stamp,
} from "../../src/research/annotation.ts"
import { Annotator } from "../../src/research/Annotator.ts"
import { Content, Paper } from "../../src/research/archive.ts"
import { Document, type Entry } from "../../src/research/entry.ts"
import { fingerprint } from "../../src/utils/fingerprint.ts"
import { Folder } from "./storage.ts"

const Scoped = Schema.Struct({ stamp: Stamp, scope: Scope })

// The hash a saved annotation's stamp names: the whole paper record, the
// model and the rubric, so a changed record needs a new annotation.
export const inputOf = (paper: Document) => fingerprint(JSON.stringify({ rubric, model, paper }))

// Whether a saved annotation still describes its paper: stamped with its
// input, every quote on its page, every passage and excerpt labelled.
export const fits = (
  annotation: typeof Annotation.Type,
  { paper, input }: { readonly paper: Document; readonly input: string },
) =>
  annotation.stamp.input === input &&
  grounded(annotation.scope, paper.content.passages) &&
  complete(annotation.labels, paper.content.passages) &&
  excerptsComplete(annotation, annotation.scope)

interface Interface {
  readonly documents: Effect.Effect<ReadonlyArray<Document>, ResearchUnavailable>
  readonly annotate: (paper: Document) => Effect.Effect<Entry, ResearchUnavailable, Annotator>
  readonly entries: Effect.Effect<ReadonlyArray<Entry>, ResearchUnavailable>
}

export class Retrieval extends Context.Service<Retrieval, Interface>()("papers/Retrieval") {
  static readonly files = (directory: string) =>
    Layer.effect(
      Retrieval,
      Effect.gen(function* () {
        const fs = yield* FileSystem
        const papers = yield* Folder

        const pathOf = Effect.fn("Retrieval.path")(function* (paper: Document) {
          const input = yield* inputOf(paper)

          return { input, path: `${directory}/annotations/${input}` }
        })

        const documents = Effect.gen(function* () {
          const names = (yield* fs.readDirectory(directory))
            .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
            .toSorted()

          const found: Array<Document> = []

          for (const name of names) {
            const decoded = yield* fs
              .readFileString(`${directory}/${name}`)
              .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Paper))))

            if (name !== `${decoded.seed.id}.json`)
              return yield* Effect.fail("Paper filename differs from identity")

            if (Content.guards.Metadata(decoded.content)) continue
            const checked = yield* papers.read(decoded.seed)

            if (Option.isNone(checked)) return yield* Effect.fail("Paper disappeared during read")
            found.push(yield* Schema.decodeUnknownEffect(Document)(checked.value))
          }

          if (found.length === 0) return yield* Effect.fail("No retained documents in corpus")

          return found
        }).pipe(
          Effect.mapError((cause) => new ResearchUnavailable({ operation: "documents", cause })),
        )

        const read = Effect.fn("Retrieval.read")(function* (paper: Document) {
          const { path, input } = yield* pathOf(paper)

          const annotation = yield* fs
            .readFileString(`${path}.json`)
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Annotation))))

          if (!fits(annotation, { paper, input }))
            return yield* Effect.fail("Annotation is stale, incomplete or ungrounded")

          return { paper, annotation }
        })

        const annotate = Effect.fn("Retrieval.annotate")(
          function* (paper: Document) {
            const { path, input } = yield* pathOf(paper)

            if (yield* fs.exists(`${path}.json`)) return yield* read(paper)
            const annotator = yield* Annotator
            yield* fs.makeDirectory(`${directory}/annotations`, { recursive: true })

            const stamp = Stamp.make({
              rubric,
              model,
              input,
              createdAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
            })

            const scoped = (yield* fs.exists(`${path}.scope.json`))
              ? yield* fs
                  .readFileString(`${path}.scope.json`)
                  .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Scoped))))
              : Scoped.make({
                  stamp,
                  scope: (yield* annotator.scope(paper.content.passages)).scope,
                })

            if (scoped.stamp.input !== input || !grounded(scoped.scope, paper.content.passages))
              return yield* Effect.fail("Scope checkpoint is stale or ungrounded")
            yield* fs.writeFileString(`${path}.scope.json.tmp`, JSON.stringify(scoped))
            yield* fs.rename(`${path}.scope.json.tmp`, `${path}.scope.json`)

            const { labels, excerpts } = yield* annotator.labels(paper.content.passages, {
              excerpts: scoped.scope.excerpts,
            })

            const classified = { labels, excerpts }

            if (
              !complete(classified.labels, paper.content.passages) ||
              !excerptsComplete(classified, scoped.scope)
            )
              return yield* Effect.fail("Incomplete labels")
            const annotation = Annotation.make({ stamp, scope: scoped.scope, ...classified })
            yield* fs.writeFileString(`${path}.json.tmp`, JSON.stringify(annotation, null, 2))
            yield* fs.rename(`${path}.json.tmp`, `${path}.json`)

            return { paper, annotation }
          },
          Effect.mapError((cause) => new ResearchUnavailable({ operation: "annotate", cause })),
        )

        const entries = documents.pipe(
          Effect.flatMap((docs) => Effect.forEach(docs, read)),
          Effect.mapError((cause) => new ResearchUnavailable({ operation: "entries", cause })),
        )

        return Retrieval.of({ documents, annotate, entries })
      }),
    )
}
