import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { collect } from "./run.ts"
import { recorded, work } from "./testing.ts"

it.effect(
  "collects discovered papers and replays the corpus without leaking passages in the report",
  () => {
    const world = recorded({
      respond: (url) =>
        new URL(url).pathname === "/works" ? Response.json({ results: [work()] }) : undefined,
    })

    return Effect.gen(function* () {
      const report = yield* collect("/papers")

      expect(report.results).toHaveLength(1)
      expect(report.unresolved).toBe(0)
      expect(report.results[0]).toMatchObject({ written: true, content: { pages: 2, passages: 2 } })
      expect(JSON.stringify(report)).not.toContain("Employment rose in France")
      expect(
        [...world.files.values()].some((value) => value.includes("Employment rose in France")),
      ).toBe(true)
      expect(world.snapshots.size).toBe(1)
      const requests = world.requests.length
      const writes = world.writes.length
      const replay = yield* collect("/papers", { mode: "Offline" })

      expect(replay.results[0]).toMatchObject({
        written: false,
        content: { pages: 2, passages: 2 },
      })
      expect(world.requests).toHaveLength(requests)
      expect(world.writes).toHaveLength(writes)
    }).pipe(Effect.provide(world.layer))
  },
)

it.effect("reports an unresolved copy without publishing restricted or failing text", () => {
  const world = recorded({
    respond: (url) =>
      new URL(url).pathname === "/works"
        ? Response.json({ results: [work()] })
        : new Response("unavailable", { status: 503 }),
  })

  return Effect.gen(function* () {
    const report = yield* collect("/papers")

    expect(report.unresolved).toBe(1)
    expect(report.results[0]).toMatchObject({ attempts: [{ result: { operation: "download" } }] })
    expect(world.snapshots.size).toBe(0)
    const requests = world.requests.length
    const replay = yield* collect("/papers", { mode: "Offline" })

    expect(replay.unresolved).toBe(1)
    expect(world.requests).toHaveLength(requests)
  }).pipe(Effect.provide(world.layer))
})
