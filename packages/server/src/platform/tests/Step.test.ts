import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"

import { recording } from "../../tests/fakes.ts"
import { Step } from "../Step.ts"
import { type WorkflowStep } from "../Step.types.ts"

// Workflows' side of a step: runs its body and saves nothing.
const workflow: WorkflowStep = {
  do: (_name, _config, callback) => callback(),
  sleep: () => Promise.resolve(),
}

describe("Step.workflow", () => {
  it.effect("records a step's spans under the span that ran the step", () => {
    const traces = recording()

    return Effect.gen(function* () {
      const step = yield* Step

      const answer = yield* step
        .run("outline FAOSTAT", Effect.succeed(1).pipe(Effect.withSpan("CatalogBuild.outline")))
        .pipe(Effect.withSpan("CatalogBuild.refine"))

      const caller = traces.spans.find((span) => span.name === "CatalogBuild.refine")
      const inside = traces.spans.find((span) => span.name === "CatalogBuild.outline")

      expect(answer).toBe(1)
      expect(inside).toBeDefined()
      expect(inside?.parent.pipe(Option.map((parent) => parent.spanId))).toEqual(
        Option.some(caller?.spanId),
      )
    }).pipe(Effect.provide(Layer.merge(Step.workflow(workflow), traces.layer)))
  })
})
