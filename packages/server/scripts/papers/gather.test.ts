import { expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

import { Content, Paper, PaperUnavailable, Seed } from "../../src/research/archive.ts"
import { gather } from "./gather.ts"
import { metadataUrl } from "./openalex.ts"
import { location, pdf, recorded, seed, work } from "./testing.ts"

const mode = { mode: "Resume" } satisfies { mode: "Resume" }

it.effect("gathers licensed text with its exact physical pages and copy provenance", () => {
  const world = recorded()

  return Effect.gen(function* () {
    const { paper } = yield* gather(seed, mode)
    const content = yield* Schema.decodeUnknownEffect(Content.cases.Text)(paper.content)

    expect(content.passages).toEqual([
      {
        page: 1,
        part: 0,
        text: "Employment rose in France. https://creativecommons.org/licenses/by/4.0/",
      },
      { page: 2, part: 0, text: "The estimate is uncertain." },
    ])
    expect(content.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(content.evidence[0].licence).toBe("https://creativecommons.org/licenses/by/4.0/")
    expect(content.pages).toBe(2)
    expect(content.emptyPages).toEqual([])
    expect(
      yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Paper))(
        world.files.get(`/papers/${seed.id}.json`),
      ),
    ).toEqual(paper)

    expect((yield* gather(seed, mode)).written).toBe(false)
    expect((yield* gather(seed, { mode: "Offline" })).written).toBe(false)
    expect(world.requests).toHaveLength(2)
    expect(world.writes).toHaveLength(1)
  }).pipe(Effect.provide(world.layer))
})

it.effect("keeps unlicensed papers as metadata and never requests their text", () => {
  const world = recorded({ metadata: work(null) })

  return Effect.gen(function* () {
    expect((yield* gather(seed, mode)).paper.content).toEqual(
      Content.cases.Metadata.make({ reason: "no-usable-copy" }),
    )
    expect(world.requests).toEqual([metadataUrl("10.1234/employment")])
    expect([...world.files.values()].join("")).not.toContain("Employment rose")
  }).pipe(Effect.provide(world.layer))
})

it.effect("never borrows one copy's licence to download another copy", () => {
  const metadata = work(null)

  const world = recorded({
    metadata: {
      ...metadata,
      locations: [
        ...metadata.locations,
        {
          id: "doi:10.1234/employment",
          doi: "https://doi.org/10.1234/employment",
          raw_source_name: "Example University",
          landing_page_url: "http://example.org/other",
          pdf_url: null,
          license: "cc-by",
          version: "submittedVersion",
        },
      ],
    },
  })

  return Effect.gen(function* () {
    expect((yield* gather(seed, mode)).paper.content).toEqual(
      Content.cases.Metadata.make({ reason: "no-usable-copy" }),
    )
    expect(world.requests).toHaveLength(1)
  }).pipe(Effect.provide(world.layer))
})

it.effect("refreshes unchanged metadata without downloading or writing again", () => {
  const world = recorded()

  return Effect.gen(function* () {
    yield* gather(seed, mode)
    expect((yield* gather(seed, { mode: "Refresh" })).written).toBe(false)
    expect(world.requests).toHaveLength(4)
    expect(world.writes).toHaveLength(1)

    world.change(work(null))
    const refreshed = yield* gather(seed, { mode: "Refresh" })
    expect(refreshed.paper.content).toEqual(
      Content.cases.Metadata.make({ reason: "no-usable-copy" }),
    )
    expect([...world.files.values()].join("")).not.toContain("Employment rose")
  }).pipe(Effect.provide(world.layer))
})

it.effect(
  "preserves completed papers when another study fails, then retries only the failed study",
  () => {
    const world = recorded({ status: 503 })

    const withoutDoi = Seed.make({
      ...seed,
      id: "b".repeat(64),
      study: { ...seed.study, doi: null },
    })

    return Effect.gen(function* () {
      yield* gather(withoutDoi, mode)
      expect(yield* gather(seed, mode).pipe(Effect.flip)).toBeInstanceOf(PaperUnavailable)
      expect(world.files.size).toBe(1)
      world.recover()
      expect((yield* gather(withoutDoi, mode)).written).toBe(false)
      expect((yield* gather(seed, mode)).written).toBe(true)
      expect(world.files.size).toBe(2)
    }).pipe(Effect.provide(world.layer))
  },
)

it.effect(
  "keeps a different DOI as metadata rather than attributing another version's text",
  () => {
    const world = recorded({ metadata: { ...work(), doi: "https://doi.org/10.1234/other" } })

    return Effect.gen(function* () {
      expect((yield* gather(seed, mode)).paper.content).toEqual(
        Content.cases.Metadata.make({ reason: "different-doi" }),
      )
      expect(world.requests).toHaveLength(1)
    }).pipe(Effect.provide(world.layer))
  },
)

it.effect("does not checkpoint an HTML error page as paper text", () => {
  const world = recorded({ body: "<html>Please log in</html>" })

  return Effect.gen(function* () {
    const result = yield* gather(seed, mode)
    expect(result.paper.attempts[0]?.result).toMatchObject({ operation: "download" })
    expect(result.paper.content).toEqual(Content.cases.Metadata.make({ reason: "no-usable-copy" }))
  }).pipe(Effect.provide(world.layer))
})

it.effect("fails closed on corrupt persisted JSON instead of refetching silently", () => {
  const world = recorded()
  world.files.set(`/papers/${seed.id}.json`, "{broken")

  return Effect.gen(function* () {
    expect(yield* gather(seed, mode).pipe(Effect.flip)).toBeInstanceOf(PaperUnavailable)
    expect(world.requests).toHaveLength(0)
    expect(world.writes).toHaveLength(0)
  }).pipe(Effect.provide(world.layer))
})

it.effect("does not retain text when the PDF contradicts the catalogue licence", () => {
  const world = recorded({ body: pdf("All rights reserved.") })

  return Effect.gen(function* () {
    expect((yield* gather(seed)).paper.content).toEqual(
      Content.cases.Metadata.make({ reason: "no-usable-copy" }),
    )
    expect([...world.files.values()].join("")).not.toContain("Employment rose")
  }).pipe(Effect.provide(world.layer))
})

it.effect("keeps a PDF with no matching licence notice as metadata only", () => {
  const world = recorded({ body: pdf("") })

  return Effect.gen(function* () {
    expect((yield* gather(seed)).paper.content).toEqual(
      Content.cases.Metadata.make({ reason: "no-usable-copy" }),
    )
    expect([...world.files.values()].join("")).not.toContain("Employment rose")
  }).pipe(Effect.provide(world.layer))
})

it.effect("keeps a missing DOI record as metadata and fetches no PDF", () => {
  const world = recorded({ status: 404 })

  return Effect.gen(function* () {
    expect((yield* gather(seed)).paper.content).toEqual(
      Content.cases.Metadata.make({ reason: "not-found" }),
    )
    expect(world.requests).toHaveLength(1)
  }).pipe(Effect.provide(world.layer))
})

it.effect("refreshes a changed seed instead of resuming its old bibliography", () => {
  const world = recorded()

  return Effect.gen(function* () {
    yield* gather(seed)
    const changed = Seed.make({ ...seed, study: { ...seed.study, doi: null } })
    const result = yield* gather(changed)

    expect(result.written).toBe(true)
    expect(result.paper.seed).toEqual(changed)
    expect(result.paper.content).toEqual(Content.cases.Metadata.make({ reason: "no-doi" }))
    expect([...world.files.values()].join("")).not.toContain("Employment rose")
  }).pipe(Effect.provide(world.layer))
})

const repositoryCopy = {
  id: "pmh:oai:econstor.eu:10419/123456",
  doi: null,
  raw_source_name: "EconStor",
  landing_page_url: "https://www.econstor.eu/handle/10419/123456",
  pdf_url: "https://www.econstor.eu/bitstream/10419/123456/1/paper.pdf",
  license: null,
  version: "submittedVersion",
}

// Same item-level metadata fields exposed by EconStor, with our own values.
const itemPage = (options: { licence?: string; pdf?: string; record?: string } = {}) => `
  <meta name="DC.identifier" content="https://hdl.handle.net/${options.record ?? "10419/123456"}">
  <meta name="citation_pdf_url" content="${options.pdf ?? repositoryCopy.pdf_url}">
  <meta name="DC.rights" content="https://www.econstor.eu/dspace/Nutzungsbedingungen">
  <meta name="DC.rights" content="${options.licence ?? "https://creativecommons.org/licenses/by/4.0/"}">
`

it.effect("uses repository item rights for a DOI-less copy with no PDF licence notice", () => {
  const metadata = work(null)

  const world = recorded({
    metadata: { ...metadata, doi: null, locations: [repositoryCopy] },
    body: pdf(""),
    respond: (url) =>
      url === repositoryCopy.landing_page_url ? new Response(itemPage()) : undefined,
  })

  const candidate = Seed.make({
    ...seed,
    openalex: metadata.id,
    study: { ...seed.study, doi: null },
  })

  return Effect.gen(function* () {
    const result = yield* gather(candidate)
    const content = yield* Schema.decodeUnknownEffect(Content.cases.Text)(result.paper.content)

    expect(content.copy.id).toBe(repositoryCopy.id)
    expect(content.copy.version).toBe("submittedVersion")
    expect(content.evidence).toMatchObject([
      {
        record: "10419/123456",
        pdf: repositoryCopy.pdf_url,
        licence: "https://creativecommons.org/licenses/by/4.0/",
        url: repositoryCopy.landing_page_url,
      },
    ])
    expect(content.passages[1]?.text).toBe("The estimate is uncertain.")
    expect(world.requests[0]).toBe(metadataUrl(metadata.id))
  }).pipe(Effect.provide(world.layer))
})

it.effect("does not apply another PDF's page licence or a site footer to this copy", () => {
  const world = recorded({
    metadata: { ...work(null), locations: [repositoryCopy] },
    respond: (url) =>
      url === repositoryCopy.landing_page_url
        ? new Response(
            itemPage({ pdf: "https://www.econstor.eu/other.pdf" }) +
              '<footer><a rel="license" href="https://creativecommons.org/licenses/by/4.0/">Site licence</a></footer>',
          )
        : undefined,
  })

  return Effect.gen(function* () {
    const { paper } = yield* gather(seed)

    expect(Content.guards.Metadata(paper.content)).toBe(true)
    expect(world.requests).not.toContain(repositoryCopy.pdf_url)
  }).pipe(Effect.provide(world.layer))
})

it.effect("rejects a restrictive item licence even when OpenAlex labels the copy CC BY", () => {
  const world = recorded({
    metadata: { ...work(), locations: [{ ...repositoryCopy, license: "cc-by" }] },
    respond: (url) =>
      url === repositoryCopy.landing_page_url
        ? new Response(itemPage({ licence: "https://creativecommons.org/licenses/by-nc/4.0/" }))
        : undefined,
  })

  return Effect.gen(function* () {
    const { paper } = yield* gather(seed)

    expect(paper.attempts[0]?.result).toMatchObject({ reason: "licence-conflict" })
    expect(world.requests).not.toContain(repositoryCopy.pdf_url)
  }).pipe(Effect.provide(world.layer))
})

it.effect(
  "falls back from a blocked publisher to an independently identified repository copy",
  () => {
    const metadata = work()
    const primary = location()

    const world = recorded({
      metadata: { ...metadata, locations: [primary, repositoryCopy] },
      respond: (url) => {
        if (url === primary.pdf_url) return new Response("blocked", { status: 403 })

        if (url === repositoryCopy.landing_page_url) return new Response(itemPage())

        return undefined
      },
    })

    return Effect.gen(function* () {
      const { paper } = yield* gather(seed)
      const content = yield* Schema.decodeUnknownEffect(Content.cases.Text)(paper.content)

      expect(content.copy.id).toBe(repositoryCopy.id)
      expect(content.copy.doi).toBeNull()
      expect(paper.attempts[0]?.result).toMatchObject({ operation: "download" })
      expect((yield* gather(seed)).written).toBe(false)
      expect(world.requests).toHaveLength(4)
    }).pipe(Effect.provide(world.layer))
  },
)

it.effect("retries only failed copies and retains completed exclusions", () => {
  let failing = true
  const metadata = work()
  const first = location()

  const next = {
    ...first,
    id: "pmh:oai:example:second",
    pdf_url: "https://example.org/second.pdf",
    version: "acceptedVersion",
  }

  const world = recorded({
    metadata: { ...metadata, locations: [first, next] },
    respond: (url) => {
      if (url === first.pdf_url) return new Response(pdf("All rights reserved."))

      if (url === next.pdf_url)
        return failing ? new Response("unavailable", { status: 503 }) : new Response(pdf())

      return undefined
    },
  })

  return Effect.gen(function* () {
    const initial = yield* gather(seed)
    expect(initial.paper.attempts).toHaveLength(2)
    failing = false
    const resumed = yield* gather(seed)
    const content = yield* Schema.decodeUnknownEffect(Content.cases.Text)(resumed.paper.content)

    expect(content.copy.id).toBe(next.id)
    expect(content.copy.version).toBe("acceptedVersion")
    expect(world.requests.filter((url) => url === first.pdf_url)).toHaveLength(1)
    expect(world.requests.filter((url) => url === next.pdf_url)).toHaveLength(2)
  }).pipe(Effect.provide(world.layer))
})

it.effect("withdraws stored text when refreshed item rights become restrictive", () => {
  let licence = "https://creativecommons.org/licenses/by/4.0/"

  const world = recorded({
    metadata: { ...work(), locations: [repositoryCopy] },
    body: pdf(""),
    respond: (url) =>
      url === repositoryCopy.landing_page_url ? new Response(itemPage({ licence })) : undefined,
  })

  return Effect.gen(function* () {
    expect(Content.guards.Text((yield* gather(seed)).paper.content)).toBe(true)
    licence = "https://creativecommons.org/licenses/by-nc/4.0/"
    const refreshed = yield* gather(seed, { mode: "Refresh" })

    expect(Content.guards.Metadata(refreshed.paper.content)).toBe(true)
    expect([...world.files.values()].join("")).not.toContain("Employment rose")
    expect(world.snapshots.size).toBe(0)
  }).pipe(Effect.provide(world.layer))
})

it.effect(
  "replays the retained PDF snapshot and refuses a changed snapshot without refetching",
  () => {
    const world = recorded()

    return Effect.gen(function* () {
      yield* gather(seed)
      expect(world.snapshots.size).toBe(1)
      const path = [...world.snapshots.keys()][0]
      expect(new TextDecoder().decode(world.snapshots.get(path ?? ""))).toBe(pdf())
      world.snapshots.set(path ?? "", new TextEncoder().encode("changed bytes"))

      expect(yield* gather(seed, { mode: "Offline" }).pipe(Effect.flip)).toBeInstanceOf(
        PaperUnavailable,
      )
      expect(world.requests).toHaveLength(2)
      expect(world.writes).toHaveLength(1)
    }).pipe(Effect.provide(world.layer))
  },
)

it.effect(
  "does not fetch an unreviewed host merely because a catalogue row claims an EconStor id",
  () => {
    const foreign = { ...repositoryCopy, landing_page_url: "https://example.org/not-an-item" }
    const world = recorded({ metadata: { ...work(), locations: [foreign] } })

    return Effect.gen(function* () {
      const result = yield* gather(seed)

      expect(Content.guards.Metadata(result.paper.content)).toBe(true)
      expect(world.requests).not.toContain(foreign.landing_page_url)
    }).pipe(Effect.provide(world.layer))
  },
)
