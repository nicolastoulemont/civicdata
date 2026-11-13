import { Effect, Layer } from "effect"
import * as FileSystem from "effect/FileSystem"
import { HttpClient, HttpClientResponse } from "effect/http"

import { Seed, Work } from "../../src/research/archive.ts"
import { Licences } from "./licences.ts"
import { OpenAlex } from "./openalex.ts"
import { Papers } from "./storage.ts"

export const seed = Seed.make({
  id: "a".repeat(64),
  openalex: null,
  study: {
    authors: ["Example, Anne"],
    title: "A study of employment",
    year: 2020,
    publisher: "Example University",
    doi: "10.1234/employment",
    url: "https://example.org/paper.pdf",
  },
})

export const location = (license: string | null = "cc-by") => ({
  id: "doi:10.1234/employment",
  doi: "https://doi.org/10.1234/employment",
  raw_source_name: "Example University",
  landing_page_url: "https://example.org/paper",
  pdf_url: "https://example.org/paper.pdf",
  license,
  version: "publishedVersion",
})

export const work = (license: string | null = "cc-by") =>
  Work.make({
    id: "https://openalex.org/W1234",
    type: "article",
    authorships: [{ author: { display_name: "Anne Example" } }],
    doi: "https://doi.org/10.1234/employment",
    title: seed.study.title,
    publication_year: 2020,
    updated_date: "2026-11-01T00:00:00",
    is_retracted: false,
    locations: [location(license)],
  })

// A real two-page PDF, built here so the fixture's text and rights are ours.
// The gather uses the real PDF parser; only HTTP and the filesystem are fake.
const stream = (text: string) => {
  const content = `BT /F1 12 Tf 40 700 Td (${text}) Tj ET\n`

  return `<< /Length ${content.length} >>\nstream\n${content}endstream`
}

export const pdf = (notice = "https://creativecommons.org/licenses/by/4.0/") => {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    stream(`Employment rose in France. ${notice}`),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    stream("The estimate is uncertain."),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]

  let text = "%PDF-1.4\n"
  const offsets = [0]

  for (const [index, object] of objects.entries()) {
    offsets.push(text.length)
    text += `${index + 1} 0 obj\n${object}\nendobj\n`
  }

  const xref = text.length
  text += `xref\n0 8\n0000000000 65535 f \n`
  text += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")
  text += `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`

  return text
}

export const recorded = (
  options: {
    metadata?: Work
    body?: string
    status?: number
    respond?: (url: string) => Response | undefined
  } = {},
) => {
  const files = new Map<string, string>()
  const snapshots = new Map<string, Uint8Array>()
  const requests: Array<string> = []
  const writes: Array<string> = []
  let metadata = options.metadata ?? work()
  let status = options.status ?? 200

  const http = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      requests.push(request.url)

      const response =
        options.respond?.(request.url) ??
        (request.url.startsWith("https://api.openalex.org/works/")
          ? Response.json(metadata, { status })
          : new Response(options.body ?? pdf(), { status: 200 }))

      return Effect.succeed(HttpClientResponse.fromWeb(request, response))
    }),
  )

  const fs = FileSystem.layerNoop({
    readDirectory: (path) =>
      Effect.succeed(
        [...files.keys()].flatMap((name) =>
          name.startsWith(`${path}/`) && !name.slice(path.length + 1).includes("/")
            ? [name.slice(path.length + 1)]
            : [],
        ),
      ),
    exists: (path) => Effect.succeed(files.has(path) || snapshots.has(path)),
    readFile: (path) => Effect.succeed(snapshots.get(path) ?? new Uint8Array()),
    writeFile: (path, bytes) =>
      Effect.sync(() => {
        snapshots.set(path, new Uint8Array(bytes))
      }),
    remove: (path) =>
      Effect.sync(() => {
        snapshots.delete(path)
        files.delete(path)
      }),
    readFileString: (path) => Effect.succeed(files.get(path) ?? ""),
    makeDirectory: () => Effect.void,
    writeFileString: (path, value) =>
      Effect.sync(() => {
        writes.push(path)
        files.set(path, value)
      }),
    rename: (from, to) =>
      Effect.sync(() => {
        const bytes = snapshots.get(from)

        if (bytes !== undefined) {
          snapshots.set(to, bytes)
          snapshots.delete(from)
        } else {
          files.set(to, files.get(from) ?? "")
          files.delete(from)
        }
      }),
  })

  return {
    files,
    snapshots,
    requests,
    writes,
    change: (next: Work) => {
      metadata = next
    },
    recover: () => {
      status = 200
    },
    layer: Layer.mergeAll(
      Papers.files("/papers").pipe(Layer.provide(fs)),
      OpenAlex.layer.pipe(Layer.provide(http)),
      Licences.layer.pipe(Layer.provide(http)),
      fs,
    ),
  }
}
