import { Context, Effect, Layer, Option, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"

import { Content, Paper, PaperUnavailable, type Seed } from "../../src/research/archive.schemas.ts"
import { fingerprint } from "../../src/utils/fingerprint.ts"

interface Interface {
  readonly read: (seed: Seed) => Effect.Effect<Option.Option<Paper>, PaperUnavailable>
  readonly write: (
    paper: Paper,
    options: { pdf: Uint8Array | null },
  ) => Effect.Effect<void, PaperUnavailable>
}

const fileOf = (seed: Seed, directory: string) => `${directory}/${seed.id}.json`

const snapshotOf = (paper: Paper, directory: string) =>
  Content.match(paper.content, {
    Metadata: () => null,
    Text: ({ sha256 }) => `${directory}/${paper.seed.id}-${sha256}.pdf`,
  })

export class Folder extends Context.Service<Folder, Interface>()("papers/Folder") {
  static readonly files = (directory: string) =>
    Layer.effect(
      Folder,
      Effect.gen(function* () {
        const fs = yield* FileSystem
        const codec = Schema.fromJsonString(Paper)

        const read = Effect.fn("Folder.read")(
          function* (seed: Seed) {
            if (!(yield* fs.exists(fileOf(seed, directory)))) return Option.none()

            const paper = yield* fs
              .readFileString(fileOf(seed, directory))
              .pipe(Effect.flatMap(Schema.decodeUnknownEffect(codec)))

            if (paper.seed.id !== seed.id || paper.seed.study.url !== seed.study.url)
              return yield* Effect.fail("Checkpoint belongs to another study")
            const snapshot = snapshotOf(paper, directory)

            if (snapshot !== null && Content.guards.Text(paper.content)) {
              const bytes = yield* fs.readFile(snapshot)

              if ((yield* fingerprint(bytes)) !== paper.content.sha256)
                return yield* Effect.fail("PDF snapshot hash differs")
            }

            return Option.some(paper)
          },
          Effect.mapError((cause) => new PaperUnavailable({ operation: "read", cause })),
        )

        const write = Effect.fn("Folder.write")(
          function* (paper: Paper, { pdf }: { pdf: Uint8Array | null }) {
            const previous = yield* read(paper.seed)
            const snapshot = snapshotOf(paper, directory)
            yield* fs.makeDirectory(directory, { recursive: true })

            if (snapshot !== null && Content.guards.Text(paper.content)) {
              if (pdf === null || (yield* fingerprint(pdf)) !== paper.content.sha256)
                return yield* Effect.fail("PDF snapshot required")
              yield* fs.writeFile(`${snapshot}.tmp`, pdf)
              yield* fs.rename(`${snapshot}.tmp`, snapshot)
            }

            const temporary = `${fileOf(paper.seed, directory)}.tmp`
            yield* fs.writeFileString(temporary, yield* Schema.encodeEffect(codec)(paper))
            yield* fs.rename(temporary, fileOf(paper.seed, directory))
            const old = Option.isSome(previous) ? snapshotOf(previous.value, directory) : null

            if (old !== null && old !== snapshot) yield* fs.remove(old)

            return undefined
          },
          Effect.mapError((cause) => new PaperUnavailable({ operation: "write", cause })),
        )

        return Folder.of({ read, write })
      }),
    )
}
