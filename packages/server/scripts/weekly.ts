// Starts one run of a stage's PaperGather Workflow
// (docs/papers.md#weekly-gather) through the Cloudflare API, with
// CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN set, and prints the
// instance's id:
//
//   pnpm --filter @repo/server run papers:weekly --stage pr-123
//
// The run is the one production's schedule starts every Monday. A stage
// without its own paper store binds no PaperGather Workflow, and the API
// refuses the run.
import { parseArgs } from "node:util"

import { Effect, Schema } from "effect"
import { FetchHttpClient } from "effect/http"

import { start } from "./start.ts"

const { values } = parseArgs({ options: { stage: { type: "string" } } })

const gather = Schema.decodeUnknownEffect(Schema.NonEmptyString)(values.stage).pipe(
  Effect.flatMap((stage) => start(stage, { workflow: "paper-gather", params: {} })),
)

await Effect.runPromise(gather.pipe(Effect.provide(FetchHttpClient.layer)))
