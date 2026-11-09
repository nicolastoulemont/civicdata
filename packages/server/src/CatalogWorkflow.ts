import type { CloudflareWorkersModule } from "@cloudflare/workers-types"
import { WorkflowEntrypoint } from "cloudflare:workers"
import { Effect, Layer } from "effect"

import { CatalogBuild, Step } from "./CatalogBuild.ts"

// The Workflow that builds the catalog, every Monday at 04:00 UTC and once
// after each deploy (packages/infra). Workers only: package.json resolves
// `@civicdata/server/workflow` to `workflow.node.ts` outside workerd.
export class CatalogWorkflow extends WorkflowEntrypoint {
  override async run(
    event: Readonly<CloudflareWorkersModule.WorkflowEvent<unknown>>,
    step: CloudflareWorkersModule.WorkflowStep,
  ) {
    await Effect.runPromise(
      CatalogBuild.run(event.timestamp.getTime()).pipe(
        Effect.provide(Layer.merge(Step.workflow(step), CatalogBuild.live)),
      ),
    )
  }
}
