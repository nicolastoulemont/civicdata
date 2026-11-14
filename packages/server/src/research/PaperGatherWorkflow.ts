import type { CloudflareWorkersModule } from "@cloudflare/workers-types"
import { WorkflowEntrypoint } from "cloudflare:workers"
import { Effect, Layer } from "effect"

import { Step } from "../platform/Step.ts"
import * as Traces from "../platform/Traces.ts"
import * as Runs from "./Runs.ts"

// The Workflow that gathers new and updated papers into the paper store
// (docs/papers.md#weekly-gather): in production every Monday at 03:00 UTC,
// elsewhere only when started by hand (scripts/weekly.ts,
// .github/workflows/paper-gather.yml). Only a stage that owns its paper store
// binds it. Its output is the run's record. Workers only: package.json
// resolves `@repo/server/workflow` to `workflows/node.ts` outside workerd.
export class PaperGatherWorkflow extends WorkflowEntrypoint {
  override async run(
    event: Readonly<CloudflareWorkersModule.WorkflowEvent<unknown>>,
    step: CloudflareWorkersModule.WorkflowStep,
  ) {
    // The tracer's scope closes when the run ends, which exports what is left.
    return await Effect.runPromise(
      Runs.gather({ run: event.instanceId, started: event.timestamp.toISOString() }).pipe(
        Effect.withSpan("PaperGatherWorkflow.run", {
          attributes: { "workflow.instance": event.instanceId },
        }),
        Effect.provide(Layer.mergeAll(Step.workflow(step), Runs.live, Traces.layer)),
      ),
    )
  }
}
