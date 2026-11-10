import type { CloudflareWorkersModule } from "@cloudflare/workers-types"
import { WorkflowEntrypoint } from "cloudflare:workers"
import { Effect, Layer } from "effect"

import { Step } from "./CatalogBuild.ts"
import { Gather } from "./Gather.ts"

// The Workflow that gathers each source's series into the store, every day at
// 05:00 UTC and once after each deploy (packages/infra). Workers only:
// package.json resolves `@civicdata/server/workflow` to `workflow.node.ts`
// outside workerd.
export class GatherWorkflow extends WorkflowEntrypoint {
  override async run(
    _event: Readonly<CloudflareWorkersModule.WorkflowEvent<unknown>>,
    step: CloudflareWorkersModule.WorkflowStep,
  ) {
    await Effect.runPromise(
      Gather.run().pipe(Effect.provide(Layer.merge(Step.workflow(step), Gather.live))),
    )
  }
}
