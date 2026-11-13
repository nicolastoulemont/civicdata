import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { PaperUnavailable } from "../../src/research/archive.ts"
import { discover } from "./discovery.ts"
import { recorded, work } from "./testing.ts"

it.effect("discovers DOI-less works and keeps distinct records with the same DOI separate", () => {
  const original = work()
  const noDoi = { ...original, id: "https://openalex.org/W5678", doi: null }
  const related = { ...original, id: "https://openalex.org/W9999" }
  const world = recorded({ respond: () => Response.json({ results: [original, noDoi, related] }) })

  return Effect.gen(function* () {
    const found = yield* discover("/papers", "Resume")

    expect(found.catalogue.searches).toHaveLength(11)
    expect(found.seeds).toHaveLength(3)
    expect(new Set(found.seeds.map(({ seed }) => seed.id)).size).toBe(3)
    expect(found.seeds.find(({ seed }) => seed.openalex === noDoi.id)?.seed.study.doi).toBeNull()
    expect(world.requests).toHaveLength(11)
    expect(world.requests.every((url) => new URL(url).searchParams.get("per-page") === "20")).toBe(
      true,
    )
    const writes = world.writes.length
    expect((yield* discover("/papers", "Resume")).seeds).toEqual(found.seeds)
    expect((yield* discover("/papers", "Offline")).seeds).toEqual(found.seeds)
    expect(world.requests).toHaveLength(11)
    expect(world.writes).toHaveLength(writes)
  }).pipe(Effect.provide(world.layer))
})

it.effect("resumes discovery at the failed query without fetching successful queries again", () => {
  let failing = true

  const world = recorded({
    respond: (url) => {
      if (failing && new URL(url).searchParams.get("search") === "fiscal multipliers") {
        return new Response("unavailable", { status: 503 })
      }

      return Response.json({ results: [work()] })
    },
  })

  return Effect.gen(function* () {
    expect(yield* discover("/papers", "Resume").pipe(Effect.flip)).toBeInstanceOf(PaperUnavailable)
    expect(world.requests).toHaveLength(3)
    failing = false
    expect((yield* discover("/papers", "Resume")).seeds).toHaveLength(1)
    expect(world.requests).toHaveLength(12)
    expect(
      world.requests.filter(
        (url) => new URL(url).searchParams.get("search") === "minimum wage employment",
      ),
    ).toHaveLength(1)
  }).pipe(Effect.provide(world.layer))
})

it.effect(
  "rejects malformed discovery records before storing a successful query checkpoint",
  () => {
    const world = recorded({
      respond: () => Response.json({ results: [{ id: "not-an-openalex-id" }] }),
    })

    return Effect.gen(function* () {
      expect(yield* discover("/papers", "Resume").pipe(Effect.flip)).toBeInstanceOf(
        PaperUnavailable,
      )
      expect(world.files.size).toBe(0)
    }).pipe(Effect.provide(world.layer))
  },
)
