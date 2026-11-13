import type { CloudflareWorkersModule } from "@cloudflare/workers-types"
import { WorkflowEntrypoint } from "cloudflare:workers"
import { Effect, Layer, Schema } from "effect"

import { Step } from "../platform/Step.ts"
import * as Traces from "../platform/Traces.ts"
import { Annotate, Params, retries } from "./Annotate.ts"

// The Workflow that annotates stored paper versions, or retires their
// annotations under older settings (docs/papers.md#annotation). Only a stage
// that owns its paper store binds it. In production its schedule starts a
// Demand run every day at 06:00 UTC; a person starts any other run with
// scripts/annotate.ts or .github/workflows/annotate.yml. Its output is each
// listed version's outcome. Workers only: package.json resolves
// `@repo/server/workflow` to `workflow.node.ts` outside workerd.
export class AnnotateWorkflow extends WorkflowEntrypoint {
  override async run(
    event: Readonly<CloudflareWorkersModule.WorkflowEvent<unknown>>,
    step: CloudflareWorkersModule.WorkflowStep,
  ) {
    // The tracer's scope closes when the run ends, which exports what is left.
    return await Effect.runPromise(
      Effect.gen(function* () {
        // A scheduled instance carries no params: it annotates what
        // questions asked for.
        const params =
          event.schedule === undefined
            ? yield* Schema.decodeUnknownEffect(Params)(event.payload)
            : Params.cases.Demand.make({})

        const annotate = yield* Annotate

        return yield* annotate.run(params, event.instanceId)
      }).pipe(
        Effect.withSpan("AnnotateWorkflow.run", {
          attributes: { "workflow.instance": event.instanceId },
        }),
        Effect.provide(Layer.mergeAll(Step.workflow(step, retries), Annotate.layer, Traces.layer)),
      ),
    )
  }
}
