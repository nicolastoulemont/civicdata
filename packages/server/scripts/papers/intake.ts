import { Clock, Effect, Option, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"

import { fingerprint } from "../../src/fingerprint.ts"
import { Content, Copy, Paper, PaperUnavailable, Seed } from "../../src/research/archive.ts"
import { Licences, PageCheck } from "../../src/research/Licences.ts"
import { metadataUrl, OpenAlex } from "../../src/research/OpenAlex.ts"
import { textOf } from "../../src/research/pdf.ts"
import { Folder } from "./storage.ts"

export const Source = Schema.Struct({
  doi: Schema.NonEmptyString.check(Schema.isPattern(/^10\.\d{4,9}\/\S+$/)),
  url: Copy.fields.pdf_url,
  record: Copy.fields.pdf_url,
  version: Copy.fields.version,
})

const copyOf = (source: typeof Source.Type, doi: string | null) =>
  Copy.make({
    id: source.record.startsWith("https://www.econstor.eu/handle/")
      ? `pmh:oai:econstor.eu:${new URL(source.record).pathname.slice(8)}`
      : source.record,
    doi,
    raw_source_name: new URL(source.record).hostname,
    landing_page_url: source.record,
    pdf_url: source.url,
    version: source.version,
    license: null,
  })

// Explicitly audited source copies stay separate from OpenAlex's native locations.
// The PDF must itself prove its reuse licence and contain the requested DOI.
export const intake = Effect.fn("Papers.intake")(
  function* (
    source: typeof Source.Type,
    options: { readonly directory: string; readonly refresh?: boolean },
  ) {
    const fs = yield* FileSystem
    const papers = yield* Folder
    const id = yield* fingerprint(`${source.doi}|${source.url}`)
    const path = `${options.directory}/${id}.json`

    if (!options.refresh && (yield* fs.exists(path))) {
      const saved = yield* fs
        .readFileString(path)
        .pipe(Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Paper))))

      if (saved.seed.id !== id || saved.seed.study.url !== source.url)
        return yield* Effect.fail("Intake identity differs")
      const checked = yield* papers.read(saved.seed)

      if (Option.isNone(checked)) return yield* Effect.fail("Intake disappeared")

      return checked.value
    }

    const provider = yield* OpenAlex
    const work = yield* provider.lookup({ openalex: null, study: { doi: source.doi } })

    if (work === null || work.doi?.toLowerCase() !== `https://doi.org/${source.doi.toLowerCase()}`)
      return yield* Effect.fail("Missing or different work")

    const seed = yield* Seed.makeEffect({
      id,
      openalex: work.id,
      study: {
        authors: work.authorships.flatMap(({ author }) =>
          author.display_name === null ? [] : [author.display_name],
        ),
        title: work.title,
        year: work.publication_year,
        publisher:
          work.locations.find((location) => location.raw_source_name !== null)?.raw_source_name ??
          `Repository copy at ${new URL(source.record).hostname}`,
        doi: source.doi,
        url: source.url,
      },
    })

    const keep = (content: typeof Content.Type, pdf: Uint8Array | null) =>
      Effect.gen(function* () {
        const paper = Paper.make({
          format: 3,
          seed,
          work,
          metadataUrl: metadataUrl(source.doi),
          retrievedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
          content,
          attempts: [],
        })

        yield* papers.write(paper, { pdf })

        return paper
      })

    if (work.is_retracted)
      return yield* keep(Content.cases.Metadata.make({ reason: "retracted" }), null)

    const copy = copyOf(source, work.doi)

    const rights = yield* (yield* Licences).forCopy(copy)

    if (PageCheck.guards.Denied(rights))
      return yield* keep(Content.cases.Metadata.make({ reason: "licence-conflict" }), null)

    const evidence = PageCheck.match(rights, {
      Unknown: () => [],
      Denied: () => [],
      Allowed: (allowed) => [allowed.evidence],
    })

    const download = yield* provider.download(copy)
    let content = yield* textOf(download, { copy, evidence })

    if (
      Content.guards.Text(content) &&
      !content.passages.some(({ text }) => text.toLowerCase().includes(source.doi.toLowerCase()))
    )
      content = Content.cases.Metadata.make({ reason: "different-doi" })

    return yield* keep(content, Content.guards.Text(content) ? download.bytes : null)
  },
  Effect.mapError((cause) => new PaperUnavailable({ operation: "intake", cause })),
)
