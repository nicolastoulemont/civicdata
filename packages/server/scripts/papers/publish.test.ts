import { expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import type { NonEmptyReadonlyArray } from "effect/Array"

import { model, rubric } from "../../src/research/annotation.ts"
import {
  Attempt,
  Content,
  Copy,
  Evidence,
  Paper,
  type Passage,
  Seed,
} from "../../src/research/archive.ts"
import { Held, Papers } from "../../src/research/Papers.ts"
import { withdraw } from "../../src/research/publication.ts"
import { annotationKey, objectsOf, PaperId } from "../../src/research/store.ts"
import { fingerprint } from "../../src/utils/fingerprint.ts"
import { Publication, publish } from "./publish.ts"
import { annotate, corpus, stage } from "./testing.ts"

const directory = corpus
const retrievedAt = "2026-11-12T00:00:00.000Z"
const licence = "https://creativecommons.org/licenses/by/4.0/"

const world = stage

type World = ReturnType<typeof world>

const passages = (): NonEmptyReadonlyArray<typeof Passage.Type> => [
  { page: 1, part: 0, text: "Training participation rose in France between 2010 and 2020." },
  { page: 2, part: 0, text: "Training participation was associated with higher employment." },
]

const excluded = Attempt.make({
  copy: Copy.make({
    id: "https://openalex.org/locations/9",
    doi: null,
    raw_source_name: "Example Press",
    landing_page_url: null,
    pdf_url: "https://example.org/restricted.pdf",
    license: null,
    version: "publishedVersion",
  }),
  result: Attempt.fields.result.cases.Excluded.make({ reason: "licence-not-admitted" }),
})

interface Gathered {
  readonly id?: string
  readonly location?: string
  readonly pdf?: string
  readonly content?: "Text" | "Metadata"
}

// A gathered record, valid by default: a paper with an admitted copy's
// text, its PDF beside it, and one excluded copy.
const gathered = ({
  id = "a".repeat(64),
  location = "https://openalex.org/locations/1",
  pdf = "%PDF-1.4 training",
  content = "Text",
}: Gathered = {}) =>
  Effect.gen(function* () {
    const bytes = new TextEncoder().encode(pdf)
    const sha256 = yield* fingerprint(bytes)
    const url = `https://example.org/${id.slice(0, 8)}.pdf`

    const copy = Copy.make({
      id: location,
      doi: "https://doi.org/10.1234/training",
      raw_source_name: "Example University",
      landing_page_url: null,
      pdf_url: url,
      license: "cc-by",
      version: "acceptedVersion",
    })

    const paper = Paper.make({
      format: 3,
      attempts: [excluded],
      seed: Seed.make({
        id,
        openalex: null,
        study: {
          authors: ["Example, Anne"],
          year: 2024,
          title: "Employment and training in France",
          publisher: "Example University",
          doi: "10.1234/training",
          url,
        },
      }),
      metadataUrl: null,
      retrievedAt,
      work: null,
      content:
        content === "Metadata"
          ? Content.cases.Metadata.make({ reason: "licence-conflict" })
          : Content.cases.Text.make({
              copy,
              id: yield* fingerprint(`${copy.id}|${copy.version}|${sha256}`),
              url,
              evidence: [Evidence.cases.Pdf.make({ url, sha256, page: 1, licence, retrievedAt })],
              sha256,
              pages: 2,
              emptyPages: [],
              passages: passages(),
            }),
    })

    return { paper, bytes, sha256 }
  })

// Writes a record and its PDF into the corpus directory.
const add = (place: World, delta: Gathered = {}) =>
  Effect.gen(function* () {
    const { paper, bytes, sha256 } = yield* gathered(delta)
    place.files.set(
      `${directory}/${paper.seed.id}.json`,
      yield* Schema.encodeEffect(Schema.fromJsonString(Paper))(paper),
    )

    if (Content.guards.Text(paper.content))
      place.files.set(`${directory}/${paper.seed.id}-${sha256}.pdf`, bytes)

    return paper
  })

const read = (id: string) =>
  Effect.gen(function* () {
    const papers = yield* Papers

    return yield* papers.read(PaperId.make(id))
  })

// What the reader answers for a paper, or how it fails.
const answer = (id: string) =>
  read(id).pipe(
    Effect.map(({ _tag }) => _tag),
    Effect.catch(({ _tag }) => Effect.succeed(_tag)),
  )

// Why a paper's copy was withdrawn, when the reader says it was.
const withdrawal = (id: string) =>
  read(id).pipe(Effect.map((held) => (Held.guards.Withdrawn(held) ? held.reason : null)))

const outcomes = (results: ReadonlyArray<{ readonly outcome: Publication }>) =>
  results.map(({ outcome }) =>
    Publication.$match(outcome, {
      Unchanged: () => "Unchanged",
      Written: () => "Written",
      Failed: () => "Failed",
    }),
  )

it.effect("publishes a corpus that reads back through the reader as gathered", () => {
  const place = world()

  return Effect.gen(function* () {
    const paper = yield* add(place)
    const annotation = yield* annotate(place, paper)
    yield* add(place, { id: "b".repeat(64), content: "Metadata" })

    expect(outcomes(yield* publish(directory))).toEqual(["Written", "Written"])

    const held = yield* read(paper.seed.id)

    if (!Held.guards.Text(held) || !Content.guards.Text(paper.content))
      throw new Error("Expected text")
    const object = JSON.stringify(paper.content.passages)

    expect(held.paper).toEqual({
      id: paper.seed.id,
      openalex: null,
      study: paper.seed.study,
      work: null,
      metadataUrl: null,
      retrievedAt,
    })
    expect(held.copy).toEqual({
      id: paper.content.id,
      location: paper.content.copy,
      evidence: paper.content.evidence,
    })
    expect(held.version).toMatchObject({
      extraction: "unpdf-2.1.0/300-words",
      url: paper.content.url,
      pdf: paper.content.sha256,
      text: yield* fingerprint(object),
      pages: 2,
      emptyPages: [],
    })
    expect(held.passages).toEqual(paper.content.passages)
    expect(held.annotation).toEqual({
      scope: annotation.scope,
      labels: annotation.labels,
      excerpts: annotation.excerpts,
    })
    expect(place.objects.get(objectsOf(held.version.id).pdf)).toEqual(
      new TextEncoder().encode("%PDF-1.4 training"),
    )
    expect(place.db.prepare("SELECT key FROM annotation").all()).toEqual([
      {
        key: yield* annotationKey({
          text: held.version.text,
          extraction: "unpdf-2.1.0/300-words",
          model,
          rubric,
        }),
      },
    ])

    // The metadata-only paper and every excluded copy hold no text.
    const listed = yield* read("b".repeat(64))

    expect(Held.guards.Metadata(listed) && listed.reason).toBe("licence-conflict")
    expect(
      place.db.prepare("SELECT paper, admission FROM copy ORDER BY paper, admission").all(),
    ).toEqual([
      { paper: "a".repeat(64), admission: "Admitted" },
      { paper: "a".repeat(64), admission: "Restricted" },
      { paper: "b".repeat(64), admission: "Restricted" },
    ])
    expect(place.objects.size).toBe(2)

    // Publication asks no model: every request went to Cloudflare's API.
    expect(place.requests.every(({ url }) => url.startsWith("https://api.cloudflare.com/"))).toBe(
      true,
    )
  }).pipe(Effect.provide(place.layer))
})

it.effect("writes nothing when the store already holds the corpus", () => {
  const place = world()

  return Effect.gen(function* () {
    yield* annotate(place, yield* add(place))
    yield* add(place, { id: "b".repeat(64), content: "Metadata" })
    yield* publish(directory)
    const before = place.requests.length

    expect(outcomes(yield* publish(directory))).toEqual(["Unchanged", "Unchanged"])
    expect(place.writes(before)).toEqual([])
  }).pipe(Effect.provide(place.layer))
})

// The version a record's text becomes: its copy under the extraction.
const versionOf = (paper: Paper) =>
  Content.guards.Text(paper.content)
    ? fingerprint(`${paper.content.id}|unpdf-2.1.0/300-words`)
    : Effect.die("Expected text")

// Answers `response` to every upload under a version's objects.
const failUploads = (
  place: World,
  { version, response }: { version: string; response: Response },
) =>
  place.refuse((request) =>
    request.method === "PUT" && request.url.includes(`/version/${version}/`)
      ? response.clone()
      : undefined,
  )

it.effect("retries only the paper whose upload failed, which stays unreadable until then", () => {
  const place = world()

  return Effect.gen(function* () {
    const failing = yield* add(place)
    yield* add(place, { id: "b".repeat(64), location: "https://openalex.org/locations/2" })
    const version = yield* versionOf(failing)
    failUploads(place, { version, response: new Response("unavailable", { status: 503 }) })

    expect(outcomes(yield* publish(directory))).toEqual(["Failed", "Written"])
    expect(yield* answer(failing.seed.id)).toBe("PaperMissing")

    place.refuse(() => undefined)
    const before = place.requests.length

    expect(outcomes(yield* publish(directory))).toEqual(["Written", "Unchanged"])
    expect(
      place
        .writes(before)
        .filter(({ sql }) => sql === undefined)
        .map(({ method, url }) => `${method} ${url.split("/objects/")[1]}`),
    ).toEqual([`PUT version/${version}/paper.pdf`, `PUT version/${version}/text.json`])
    expect(yield* answer(failing.seed.id)).toBe("Text")
  }).pipe(Effect.provide(place.layer))
})

it.effect(
  "never activates a corrupt object or a record whose PDF differs, and keeps the previous version",
  () => {
    const place = world()

    return Effect.gen(function* () {
      const first = yield* add(place)
      yield* publish(directory)
      const previous = yield* versionOf(first)

      // A new copy of the same paper, which R2 stores with other bytes.
      const next = yield* add(place, { pdf: "%PDF-1.4 training, second printing" })
      const version = yield* versionOf(next)

      place.refuse((request) =>
        request.method === "GET" && request.url.includes(`/version/${version}/paper.pdf`)
          ? new Response("%PDF-1.4 corrupted")
          : undefined,
      )

      // A record whose PDF on disk has another hash than the record names.
      const broken = yield* add(place, {
        id: "b".repeat(64),
        location: "https://openalex.org/locations/2",
      })

      if (!Content.guards.Text(broken.content)) throw new Error("Expected text")
      place.files.set(
        `${directory}/${broken.seed.id}-${broken.content.sha256}.pdf`,
        new TextEncoder().encode("%PDF-1.4 swapped"),
      )

      const results = yield* publish(directory)

      expect(outcomes(results)).toEqual(["Failed", "Failed"])
      expect(JSON.stringify(results)).toContain("R2 holds other bytes")
      expect(JSON.stringify(results)).toContain("PDF hash differs")
      const kept = yield* read(first.seed.id)

      expect(Held.guards.Text(kept) && kept.version.id).toBe(previous)
      expect(yield* answer(broken.seed.id)).toBe("PaperMissing")
    }).pipe(Effect.provide(place.layer))
  },
)

it.effect(
  "withdraws a copy's text with its reason and keeps the annotation another copy shares",
  () => {
    const place = world()

    return Effect.gen(function* () {
      // Two copies with the same text share one annotation.
      const withdrawn = yield* add(place)

      const kept = yield* add(place, {
        id: "b".repeat(64),
        location: "https://openalex.org/locations/2",
      })

      yield* annotate(place, withdrawn)
      yield* annotate(place, kept)
      yield* publish(directory)

      if (!Content.guards.Text(withdrawn.content)) throw new Error("Expected text")
      const version = yield* versionOf(withdrawn)

      expect(yield* withdraw(withdrawn.content.id, { reason: "Rights" })).toEqual({
        paper: withdrawn.seed.id,
        versions: 1,
      })
      expect(yield* withdrawal(withdrawn.seed.id)).toBe("Rights")
      expect(objects(place).some((key) => key.includes(version))).toBe(false)
      expect(
        place.db.prepare("SELECT version FROM passage WHERE version = ?").all(version),
      ).toEqual([])
      const shared = yield* read(kept.seed.id)

      expect(Held.guards.Text(shared) && shared.annotation).toMatchObject({ excerpts: [] })
      expect(place.db.prepare("SELECT key FROM annotation").all()).toHaveLength(1)

      // Withdrawing again, or publishing the same corpus, changes nothing.
      const before = place.requests.length
      yield* withdraw(withdrawn.content.id, { reason: "Rights" })
      expect(outcomes(yield* publish(directory))).toEqual(["Unchanged", "Unchanged"])
      expect(place.writes(before)).toEqual([])

      // A later copy that fails to upload leaves the paper withdrawn.
      const next = yield* add(place, { pdf: "%PDF-1.4 training, second printing" })
      failUploads(place, {
        version: yield* versionOf(next),
        response: new Response("unavailable", { status: 503 }),
      })

      expect(outcomes(yield* publish(directory))).toEqual(["Failed", "Unchanged"])
      expect(yield* withdrawal(withdrawn.seed.id)).toBe("Rights")
    }).pipe(Effect.provide(place.layer))
  },
)

it.effect(
  "refuses to list as metadata-only a paper whose text the store serves until it is withdrawn",
  () => {
    const place = world()

    return Effect.gen(function* () {
      const paper = yield* add(place)
      yield* publish(directory)

      if (!Content.guards.Text(paper.content)) throw new Error("Expected text")
      yield* add(place, { content: "Metadata" })

      const [refused] = yield* publish(directory)

      expect(refused?.outcome).toEqual(
        Publication.Failed({ problem: expect.stringContaining("withdraw its copy first") }),
      )
      expect(yield* answer(paper.seed.id)).toBe("Text")

      yield* withdraw(paper.content.id, { reason: "Retraction" })

      expect(outcomes(yield* publish(directory))).toEqual(["Written"])

      const held = yield* read(paper.seed.id)

      expect(Held.guards.Withdrawn(held) && held.reason).toBe("Retraction")
    }).pipe(Effect.provide(place.layer))
  },
)

it.effect("imports only annotations that still fit their record", () => {
  const place = world()

  return Effect.gen(function* () {
    const paper = yield* add(place)
    yield* annotate(place, paper, { input: "f".repeat(64) })
    yield* publish(directory)

    const held = yield* read(paper.seed.id)

    expect(Held.guards.Text(held) && held.annotation).toBeNull()
    expect(place.db.prepare("SELECT key FROM annotation").all()).toEqual([])
  }).pipe(Effect.provide(place.layer))
})

const objects = (place: World) => [...place.objects.keys()]
