// Starts one run of a stage's Annotate Workflow (docs/papers.md#annotation)
// through the Cloudflare API, with CLOUDFLARE_ACCOUNT_ID and
// CLOUDFLARE_API_TOKEN set, and prints the instance's id:
//
//   pnpm --filter @repo/server run annotate --stage pr-123 <version>...
//
// `--command retry` also lets the run claim the listed versions' Abandoned
// keys. `--command retire` instead clears each listed version's active
// annotation when it is under settings other than the current ones.
// `--command demand`, with no versions, annotates what questions asked for,
// as production's daily run does. A stage without its own paper store binds
// no Annotate Workflow, and the API refuses the run.
import { parseArgs } from "node:util"

import { Effect, Schema } from "effect"
import { FetchHttpClient } from "effect/http"

import { Params } from "../src/research/Annotate.schemas.ts"
import { start } from "./start.ts"

const { values, positionals } = parseArgs({
  options: {
    stage: { type: "string" },
    command: { type: "string", default: "annotate" },
  },
  allowPositionals: true,
})

const Command = Schema.Literals(["annotate", "retry", "retire", "demand"])

const annotate = Effect.gen(function* () {
  const stage = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(values.stage)
  const command = yield* Schema.decodeUnknownEffect(Command)(values.command)

  const params =
    command === "demand"
      ? yield* Schema.decodeUnknownEffect(Schema.Tuple([]))(positionals).pipe(
          Effect.as(Params.cases.Demand.make({})),
        )
      : yield* Schema.decodeUnknownEffect(Params.cases.Annotate.fields.versions)(positionals).pipe(
          Effect.map((versions) =>
            command === "retire"
              ? Params.cases.Retire.make({ versions })
              : Params.cases.Annotate.make({ versions, retry: command === "retry" }),
          ),
        )

  return yield* start(stage, { workflow: "annotate", params })
})

await Effect.runPromise(annotate.pipe(Effect.provide(FetchHttpClient.layer)))
