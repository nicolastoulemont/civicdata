import type { CloudflareWorkersModule } from "@cloudflare/workers-types"
import { env, WorkflowEntrypoint } from "cloudflare:workers"
import { Effect, Layer, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"

import { CatalogBuild, Step } from "./CatalogBuild.ts"
import { Classifier } from "./Classifier.ts"
import { modelClassifier } from "./ModelClassifier.ts"
import { PoliticsBuild } from "./PoliticsBuild.ts"

// OpenAI's Decisions API classifies directions where infra turns it on
// (production) and the deployment has a key. Elsewhere the build classifies
// nothing, and the agent keeps the key.
const classifier = () =>
  env.CLASSIFY_DIRECTIONS === "on" && env.OPENAI_API_KEY !== undefined
    ? modelClassifier(Redacted.make(env.OPENAI_API_KEY)).pipe(Layer.provide(FetchHttpClient.layer))
    : Classifier.off

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
      Effect.all(
        [CatalogBuild.run({ id: event.instanceId, generation }), PoliticsBuild.run(generation)],
        {
          concurrency: "unbounded",
          mode: "result",
        },
      ).pipe(
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
