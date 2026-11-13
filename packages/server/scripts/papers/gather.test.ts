import { assert, expect, it } from "@effect/vitest"
import { Duration, Effect, Layer, Schema } from "effect"

import { Content, Copy, Evidence, Paper, Seed } from "../../src/research/archive.ts"
import { Outcome, run, type Topic } from "../../src/research/Gather.ts"
import { metadataUrl } from "../../src/research/OpenAlex.ts"
import { Held, Papers } from "../../src/research/Papers.ts"
import { annotationKey, PaperId } from "../../src/research/store.ts"
import { pdf } from "../../src/research/tests/pdf.ts"
import { fingerprint } from "../../src/utils/fingerprint.ts"
import { local, summaryOf } from "./gather.ts"
import { publish } from "./publish.ts"
import { annotate, corpus, location, stage, work } from "./testing.ts"

// The local gather against a stage's store on Cloudflare's wire, with
// OpenAlex and the publisher on the same wire, after the publication
// command published the corpus record of the same work.

const topic: Topic = { area: "labour", query: "minimum wage employment" }

const extraction = "unpdf-2.1.0/300-words"
const licence = "https://creativecommons.org/licenses/by/4.0/"
const retrievedAt = "2026-11-12T15:15:38.038Z"

// OpenAlex lists the work, and its copy's host serves the fixture PDF.
const web = (request: Request) => {
  const url = new URL(request.url)

  if (url.host !== "api.openalex.org") return new Response(pdf())

  return Response.json({
    meta: { next_cursor: url.searchParams.get("cursor") === "*" ? "1" : null },
    results:
      url.searchParams.get("cursor") === "*" || url.searchParams.has("filter") ? [work()] : [],
  })
}

// The record discovery and the folder gather wrote for the work: its seed
// hashes the OpenAlex id, and its copy id the location, version and PDF.
const recordOf = Effect.gen(function* () {
  const listed = work()
  const bytes = new TextEncoder().encode(pdf())
  const sha256 = yield* fingerprint(bytes)
  const copy = Copy.make({ ...location(), version: "publishedVersion" })

  const paper = Paper.make({
    format: 3,
    attempts: [],
    seed: Seed.make({
      id: yield* fingerprint(listed.id),
      openalex: listed.id,
      study: {
        title: listed.title,
        year: listed.publication_year,
        doi: "10.1234/employment",
        authors: ["Anne Example"],
        publisher: "Example University",
        url: listed.id,
      },
    }),
    metadataUrl: metadataUrl(listed.id),
    retrievedAt,
    work: listed,
    content: Content.cases.Text.make({
      copy,
      id: yield* fingerprint(`${copy.id}|${copy.version}|${sha256}`),
      url: copy.pdf_url,
      evidence: [
        Evidence.cases.Pdf.make({ url: copy.pdf_url, sha256, page: 1, licence, retrievedAt }),
      ],
      sha256,
      pages: 2,
      emptyPages: [],
      passages: [
        { page: 1, part: 0, text: `Employment rose in France. ${licence}` },
        { page: 2, part: 0, text: "The estimate is uncertain." },
      ],
    }),
  })

  return { paper, bytes, sha256 }
})

const gatherOn = (place: ReturnType<typeof stage>) =>
  run({ topics: [topic] }).pipe(
    Effect.provide(
      local(place.target, { pacing: { gap: Duration.zero, hosts: {} } }).layer.pipe(
        Layer.provide(place.http),
      ),
    ),
  )

it.effect("gathers a published corpus work into the same copy, version and annotation key", () => {
  const place = stage({ web })

  return Effect.gen(function* () {
    const { paper, bytes, sha256 } = yield* recordOf
    place.files.set(
      `${corpus}/${paper.seed.id}.json`,
      yield* Schema.encodeEffect(Schema.fromJsonString(Paper))(paper),
    )
    place.files.set(`${corpus}/${paper.seed.id}-${sha256}.pdf`, bytes)
    const annotation = yield* annotate(place, paper)
    yield* publish(corpus)

    assert(Content.guards.Text(paper.content), "Expected the record's text")
    const version = yield* fingerprint(`${paper.content.id}|${extraction}`)
    const before = place.db.prepare("SELECT id FROM version").all()

    const report = yield* gatherOn(place)

    // No model: every request went to Cloudflare, OpenAlex or the copy's host.
    expect(new Set(place.requests.map(({ url }) => new URL(url).host))).toEqual(
      new Set(["api.cloudflare.com", "api.openalex.org", "example.org"]),
    )
    expect(summaryOf(report).outcomes).toEqual({
      Text: 1,
      Metadata: 0,
      Covered: 0,
      Refused: 0,
      Failed: 0,
    })
    expect(report.works[0]?.outcome).toEqual(
      Outcome.cases.Text.make({ paper: paper.seed.id, version }),
    )
    expect(place.db.prepare("SELECT id FROM version").all()).toEqual(before)
    expect(place.db.prepare("SELECT id, admission FROM copy").all()).toEqual([
      { id: paper.content.id, admission: "Admitted" },
    ])

    // The imported annotation stays the version's, under the same key.
    const held = yield* (yield* Papers).read(PaperId.make(paper.seed.id))

    assert(Held.guards.Text(held), "Expected the paper's text")
    expect(held.version.id).toBe(version)
    expect(held.annotation).toEqual({
      scope: annotation.scope,
      labels: annotation.labels,
      excerpts: annotation.excerpts,
    })
    expect(place.db.prepare("SELECT key FROM annotation").all()).toEqual([
      {
        key: yield* annotationKey({
          text: held.version.text,
          extraction,
          model: annotation.stamp.model,
          rubric: annotation.stamp.rubric,
        }),
      },
    ])
  }).pipe(Effect.provide(place.layer))
})

it.effect("writes nothing and fetches no PDF when it runs again with nothing changed", () => {
  const place = stage({ web })

  return Effect.gen(function* () {
    yield* gatherOn(place)
    const from = place.requests.length

    const report = yield* gatherOn(place)

    expect(summaryOf(report).works).toBe(0)
    expect(place.writes(from)).toEqual([])
    expect(place.requests.slice(from).filter(({ url }) => !url.startsWith("https://api."))).toEqual(
      [],
    )
  }).pipe(Effect.provide(place.layer))
})

it.effect("reports each work that failed, without its text", () => {
  const place = stage({
    web: (request) =>
      new URL(request.url).host === "api.openalex.org"
        ? web(request)
        : new Response("unavailable", { status: 503 }),
  })

  return Effect.gen(function* () {
    const summary = summaryOf(yield* gatherOn(place))

    expect(summary.outcomes.Failed).toBe(1)
    expect(summary.problems).toMatchObject([
      { work: work().id, title: work().title, outcome: { operation: "download" } },
    ])
    expect(JSON.stringify(summary)).not.toContain("Employment rose")
  }).pipe(Effect.provide(place.layer))
})
