import type { CloudflareWorkersModule } from "@cloudflare/workers-types"
import { WorkflowEntrypoint } from "cloudflare:workers"
import { Effect, Layer, Schema } from "effect"

import { Step } from "./CatalogBuild.ts"
import { Annotate, Params, retries } from "./research/Annotate.ts"
import * as Traces from "./Traces.ts"

// The Workflow that annotates a list of stored paper versions, or retires
// their annotations under older settings (docs/papers.md#annotation). Only a
// stage that owns its paper store binds it, and only a person starts it:
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
        const params = yield* Schema.decodeUnknownEffect(Params)(event.payload)
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
