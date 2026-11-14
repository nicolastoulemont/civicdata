import type { CloudflareWorkersModule } from "@cloudflare/workers-types"
import { WorkflowEntrypoint } from "cloudflare:workers"
import { Effect, Layer } from "effect"

import { Step } from "../platform/Step.ts"
import * as Traces from "../platform/Traces.ts"
import { Gather } from "./Gather.ts"

// The Workflow that gathers each source's series into the store: in
// production every day at 05:00 UTC, elsewhere only when started by hand
// (packages/infra). Workers only: package.json resolves
// `@repo/server/workflow` to `workflows/node.ts` outside workerd.
export class GatherWorkflow extends WorkflowEntrypoint {
  override async run(
    event: Readonly<CloudflareWorkersModule.WorkflowEvent<unknown>>,
    step: CloudflareWorkersModule.WorkflowStep,
  ) {
    // The tracer's scope closes when the run ends, which exports what is left.
    await Effect.runPromise(
      Gather.run().pipe(
        Effect.withSpan("GatherWorkflow.run", {
          attributes: { "workflow.instance": event.instanceId },
        }),
        Effect.provide(Layer.mergeAll(Step.workflow(step), Gather.live, Traces.layer)),
      ),
    )
  }
}
