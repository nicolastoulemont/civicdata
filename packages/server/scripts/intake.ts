import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Layer, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"

import * as Fetch from "../src/Fetch.ts"
import { Content } from "../src/research/archive.ts"
import { Licences } from "../src/research/Licences.ts"
import { OpenAlex } from "../src/research/OpenAlex.ts"
import { intake, Source } from "./papers/intake.ts"
import { Folder } from "./papers/storage.ts"

const { values } = parseArgs({
  options: {
    refresh: { type: "boolean", default: false },
    corpus: {
      type: "string",
      default: fileURLToPath(new URL("../../../.papers/corpus-v4", import.meta.url)),
    },
    sources: {
      type: "string",
      default: fileURLToPath(
        new URL("../../../docs/research/papers/expanded/sources.json", import.meta.url),
      ),
    },
  },
})

const program = Effect.gen(function* () {
  const fs = yield* FileSystem

  const sources = yield* fs
    .readFileString(values.sources)
    .pipe(Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Source)))))

  for (const source of sources) {
    yield* intake(source, { directory: values.corpus, refresh: values.refresh }).pipe(
      Effect.tap((paper) =>
        Effect.sync(() =>
          console.log(
            JSON.stringify({
              id: paper.seed.id,
              title: paper.seed.study.title,
              content: Content.guards.Text(paper.content) ? "Text" : "Metadata",
            }),
          ),
        ),
      ),
      Effect.catchTag("PaperUnavailable", (error) =>
        Effect.sync(() => {
          process.exitCode = 1
          let cause: unknown = error

          while (cause instanceof Error && cause.cause !== undefined) cause = cause.cause
          console.error(
            JSON.stringify({
              doi: source.doi,
              failed: error.operation,
              problem: String(cause),
            }),
          )
        }),
      ),
    )
  }
})

await Effect.runPromise(
  program.pipe(
    Effect.provide(
      Layer.mergeAll(
        Folder.files(values.corpus),
        Layer.mergeAll(OpenAlex.layer, Licences.layer).pipe(Layer.provide(Fetch.layer)),
      ).pipe(Layer.provideMerge(NodeFileSystem.layer)),
    ),
  ),
)
