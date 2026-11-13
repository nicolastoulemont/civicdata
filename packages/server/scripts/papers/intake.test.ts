import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Content, PaperUnavailable } from "../../src/research/archive.ts"
import { pdf } from "../../test/pdf.ts"
import { intake, Source } from "./intake.ts"
import { recorded, work } from "./testing.ts"

const source = Source.make({
  doi: "10.1234/employment",
  url: "https://example.org/paper.pdf",
  record: "https://example.org/item",
  version: "publishedVersion",
})

it.effect("keeps a licensed identified source copy and resumes without fetching it again", () => {
  const world = recorded({
    body: pdf("https://creativecommons.org/licenses/by/4.0/ 10.1234/employment"),
  })

  return Effect.gen(function* () {
    const first = yield* intake(source, { directory: "/papers" })
    expect(Content.guards.Text(first.content)).toBe(true)
    expect(first.work?.id).toBe(work().id)
    expect(first.content).toMatchObject({ copy: { id: source.record, version: source.version } })
    expect(yield* intake(source, { directory: "/papers" })).toEqual(first)
    expect(world.requests).toHaveLength(2)
    expect(world.writes).toHaveLength(1)
    expect(world.snapshots.size).toBe(1)
  }).pipe(Effect.provide(world.layer))
})

it.effect("keeps a PDF with a different DOI as metadata without storing its bytes", () => {
  const world = recorded({
    body: pdf("https://creativecommons.org/licenses/by/4.0/ 10.1234/different"),
  })

  return Effect.gen(function* () {
    const paper = yield* intake(source, { directory: "/papers" })
    expect(paper.content).toEqual(Content.cases.Metadata.make({ reason: "different-doi" }))
    expect(world.snapshots.size).toBe(0)
  }).pipe(Effect.provide(world.layer))
})

it.effect("refuses mismatched metadata before downloading a copy", () => {
  const world = recorded({ metadata: { ...work(), doi: "https://doi.org/10.1234/different" } })

  return Effect.gen(function* () {
    expect(yield* intake(source, { directory: "/papers" }).pipe(Effect.flip)).toBeInstanceOf(
      PaperUnavailable,
    )
    expect(world.requests).toHaveLength(1)
    expect(world.files.size).toBe(0)
  }).pipe(Effect.provide(world.layer))
})

it.effect(
  "recognises a licence URL wrapped after its scheme and still rejects non-commercial reuse",
  () => {
    const world = recorded({
      body: pdf("http://\ncreativecommons.org/licenses/by/4.0/ 10.1234/employment"),
    })

    const denied = recorded({
      body: pdf("http://\ncreativecommons.org/licenses/by-nc/4.0/ 10.1234/employment"),
    })

    return Effect.gen(function* () {
      const allowed = yield* intake(source, { directory: "/papers" }).pipe(
        Effect.provide(world.layer),
      )

      expect(Content.guards.Text(allowed.content)).toBe(true)

      const rejected = yield* intake(source, { directory: "/papers" }).pipe(
        Effect.provide(denied.layer),
      )

      expect(rejected.content).toEqual(Content.cases.Metadata.make({ reason: "licence-conflict" }))
      expect(denied.snapshots.size).toBe(0)
    })
  },
)

it.effect("removes active text and bytes when metadata marks the study retracted", () => {
  const world = recorded({
    body: pdf("https://creativecommons.org/licenses/by/4.0/ 10.1234/employment"),
  })

  return Effect.gen(function* () {
    yield* intake(source, { directory: "/papers" })
    world.change({ ...work(), is_retracted: true })
    const updated = yield* intake(source, { directory: "/papers", refresh: true })
    expect(updated.content).toEqual(Content.cases.Metadata.make({ reason: "retracted" }))
    expect(world.requests).toHaveLength(3)
    expect(world.snapshots.size).toBe(0)
    expect([...world.files.values()].join(" ")).not.toContain("Employment rose in France")
  }).pipe(Effect.provide(world.layer))
})
