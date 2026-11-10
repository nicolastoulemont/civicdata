import type { CloudflareWorkersModule } from "@cloudflare/workers-types"
import { env, WorkflowEntrypoint } from "cloudflare:workers"
import { Effect, Layer } from "effect"

import { CatalogBuild, Step } from "./CatalogBuild.ts"
import { Classifier } from "./Classifier.ts"
import { openAi } from "./OpenAi.ts"
import { PoliticsBuild } from "./PoliticsBuild.ts"

// The agent's OpenAI model classifies directions, when the deployment has a
// key; without one, the build classifies nothing.
const classifier = () =>
  env.OPENAI_API_KEY === undefined
    ? Classifier.unavailable
    : Classifier.layer.pipe(Layer.provide(openAi(env.OPENAI_API_KEY, env.OPENAI_MODEL)))

// The Workflow that builds the catalog and stores the political records,
// every Monday at 04:00 UTC and once after each deploy (packages/infra). The
// two builds run side by side, and one failing does not stop the other.
// Workers only: package.json resolves `@civicdata/server/workflow` to
// `workflow.node.ts` outside workerd.
export class CatalogWorkflow extends WorkflowEntrypoint {
  override async run(
    event: Readonly<CloudflareWorkersModule.WorkflowEvent<unknown>>,
    step: CloudflareWorkersModule.WorkflowStep,
  ) {
    const generation = event.timestamp.getTime()

    await Effect.runPromise(
      Effect.all([CatalogBuild.run(generation), PoliticsBuild.run(generation)], {
        concurrency: "unbounded",
        mode: "result",
      }).pipe(
        Effect.flatMap(([catalog, politics]) =>
          Effect.all([Effect.fromResult(catalog), Effect.fromResult(politics)]),
        ),
        Effect.provide(
          Layer.mergeAll(
            Step.workflow(step),
            CatalogBuild.live.pipe(Layer.provide(classifier())),
            PoliticsBuild.live,
          ),
        ),
      ),
    )
  }
}
