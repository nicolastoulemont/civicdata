import { DatabaseSync } from "node:sqlite"

import { Effect, Layer, Redacted, Schema } from "effect"
import * as FileSystem from "effect/FileSystem"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http"

import { Annotation, model, rubric, Scope } from "../../src/research/annotation.ts"
import { Copy, Paper, Seed, Work } from "../../src/research/archive.ts"
import { Bucket } from "../../src/research/Bucket.ts"
import { Document } from "../../src/research/entry.ts"
import { Licences } from "../../src/research/Licences.ts"
import { OpenAlex } from "../../src/research/OpenAlex.ts"
import { Papers } from "../../src/research/Papers.ts"
import { textOf } from "../../src/research/pdf.ts"
import { pdf } from "../../src/research/tests/pdf.ts"
import { d1 } from "../d1.ts"
import { inputOf } from "./retrieval.ts"
import { Folder } from "./storage.ts"

// The names directly under `path` among a fake filesystem's paths.
const namesUnder = (paths: Iterable<string>, path: string) =>
  [...paths].flatMap((name) =>
    name.startsWith(`${path}/`) && !name.slice(path.length + 1).includes("/")
      ? [name.slice(path.length + 1)]
      : [],
  )

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
    readDirectory: (path) => Effect.succeed(namesUnder(files.keys(), path)),
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
      Folder.files("/papers").pipe(Layer.provide(fs)),
      OpenAlex.layer.pipe(Layer.provide(http)),
      Licences.layer.pipe(Layer.provide(http)),
      fs,
    ),
  }
}

// Saves the fixture paper's licensed text in the corpus folder, as a
// gather of the PDF fixture writes it, without a request.
export const saved = Effect.gen(function* () {
  const bytes = new TextEncoder().encode(pdf())
  const retrievedAt = "2026-11-01T00:00:00.000Z"
  const copy = Copy.make({ ...location(), version: "publishedVersion" })

  const content = yield* textOf({ bytes, url: copy.pdf_url, retrievedAt }, { copy, evidence: [] })

  const paper = Paper.make({
    format: 3,
    seed,
    metadataUrl: null,
    retrievedAt,
    work: work(),
    content,
    attempts: [],
  })

  yield* (yield* Folder).write(paper, { pdf: bytes })

  return paper
})

// A stage's paper store on the wire: D1's HTTP API answered by SQLite with
// foreign keys on, as D1 runs them, and R2's object API by a map. `web`
// answers every other request, such as OpenAlex's and a publisher's. The
// corpus directory is an in-memory filesystem.

const Query = Schema.Struct({
  sql: Schema.String,
  params: Schema.Array(Schema.Union([Schema.String, Schema.Finite, Schema.Null])),
})

// Lets every request through to the store.
const accept = (): Response | undefined => undefined

// Answers no request outside Cloudflare's API.
const offline = () => new Response("No such host", { status: 404 })

export const stage = ({
  web = offline,
}: { readonly web?: (request: Request) => Response | Promise<Response> } = {}) => {
  const db = new DatabaseSync(":memory:")
  db.exec("PRAGMA foreign_keys = ON")
  const objects = new Map<string, Uint8Array>()
  const files = new Map<string, string | Uint8Array>()
  const requests: Array<{ method: string; url: string; sql?: string }> = []
  let refuse: (request: Request) => Response | undefined = accept

  const d1Answer = async (request: Request) => {
    const { sql, params } = Schema.decodeUnknownSync(Query)(await request.json())
    requests.push({ method: request.method, url: request.url, sql })

    try {
      const results = db.prepare(sql).all(...params)

      return Response.json({
        result: [{ results, meta: { rows_read: results.length, rows_written: 0, size_after: 0 } }],
      })
    } catch {
      return new Response("SQLite refused the statement", { status: 400 })
    }
  }

  const r2Answer = async (request: Request) => {
    requests.push({ method: request.method, url: request.url })
    const key = decodeURIComponent(new URL(request.url).pathname.split("/objects/")[1] ?? "")
    const held = objects.get(key)

    if (request.method === "PUT") objects.set(key, new Uint8Array(await request.arrayBuffer()))

    if (request.method === "DELETE") objects.delete(key)

    if (request.method === "GET")
      return held === undefined
        ? new Response(null, { status: 404 })
        : new Response(Uint8Array.from(held))

    return Response.json({ success: true })
  }

  const wire: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const refused = refuse(request)

    if (refused !== undefined) {
      requests.push({ method: request.method, url: request.url })

      return refused
    }

    if (!request.url.startsWith("https://api.cloudflare.com/")) {
      requests.push({ method: request.method, url: request.url })

      return web(request)
    }

    return request.url.includes("/d1/database/") ? d1Answer(request) : r2Answer(request)
  }

  const http = FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, wire)))
  const target = { account: "account", token: Redacted.make("token") }

  const store = Layer.mergeAll(
    d1({ ...target, database: "papers" }).layer,
    Bucket.r2({ ...target, bucket: "papers" }),
  ).pipe(Layer.provide(http))

  // The Worker's reader, over the same store.
  const reader = Papers.make({
    get: async (key) => {
      const bytes = objects.get(key)

      return bytes === undefined ? null : { text: async () => new TextDecoder().decode(bytes) }
    },
  })

  // The corpus directory, which publication only reads.
  const fs = FileSystem.layerNoop({
    exists: (path) => Effect.succeed(files.has(path)),
    readFile: (path) => {
      const value = files.get(path) ?? ""

      return Effect.succeed(value instanceof Uint8Array ? value : new TextEncoder().encode(value))
    },
    readFileString: (path) => Effect.succeed(String(files.get(path) ?? "")),
    readDirectory: (path) => Effect.succeed(namesUnder(files.keys(), path)),
  })

  return {
    db,
    objects,
    files,
    requests,
    refuse: (rule: typeof refuse) => {
      refuse = rule
    },
    // What one run sent: its statements that write, and its R2 writes.
    writes: (from: number) =>
      requests
        .slice(from)
        .filter(({ method, sql }) =>
          sql === undefined ? method !== "GET" : /^\s*(INSERT|UPDATE|DELETE)/i.test(sql),
        ),
    // The stage's names, and the wire every client sends through.
    target: { ...target, database: "papers", bucket: "papers" },
    http,
    layer: Layer.mergeAll(reader.pipe(Layer.provide(store)), store, fs),
  }
}

// The corpus directory a stage's filesystem holds.
export const corpus = "/corpus"

// Saves an annotation that fits the record, as the research script does.
export const annotate = (
  place: ReturnType<typeof stage>,
  paper: Paper,
  { input }: { readonly input?: string } = {},
) =>
  Effect.gen(function* () {
    const document = yield* Schema.decodeUnknownEffect(Document)(paper)
    const fits = yield* inputOf(document)

    const annotation = Annotation.make({
      stamp: { rubric, model, input: input ?? fits, createdAt: "2026-11-12T00:00:00.000Z" },
      scope: {
        population: null,
        excerpts: [],
        countries: [],
        regions: [],
        periods: [],
        design: Scope.fields.design.cases.Unknown.make({}),
      },
      labels: document.content.passages.map(({ page, part }) => ({
        page,
        part,
        category: "Association",
        confidence: 0.95,
      })),
      excerpts: [],
    })

    place.files.set(`${corpus}/annotations/${fits}.json`, JSON.stringify(annotation))

    return annotation
  })
