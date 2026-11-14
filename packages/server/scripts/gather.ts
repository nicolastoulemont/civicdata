// Manual operation: gathers papers for the reviewed topics into the paper
// store of the stage whose database and bucket the person running it names
// (docs/papers.md#local-gather). No model is asked.
import { parseArgs } from "node:util"

import { Config, Console, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"

import { run } from "../src/research/Gather.ts"
import { caps, limits, local, summaryOf } from "./papers/gather.ts"

const { values } = parseArgs({ options: { pages: { type: "string" } } })

const pages = values.pages === undefined ? {} : { pages: Number(values.pages) }

if (pages.pages !== undefined && !(Number.isInteger(pages.pages) && pages.pages > 0))
  throw new Error("--pages takes a positive whole number")

const program = Effect.gen(function* () {
  const { usage, layer } = local(
    {
      account: yield* Config.String("CLOUDFLARE_ACCOUNT_ID"),
      token: yield* Config.Redacted("CLOUDFLARE_API_TOKEN"),
      database: yield* Config.String("PAPERS_D1_ID"),
      bucket: yield* Config.String("PAPERS_R2_BUCKET"),
    },
    { openalex: yield* Config.option(Config.Redacted("OPENALEX_API_KEY")) },
  )

  const report = yield* run({ limits: { ...limits, ...pages }, caps }).pipe(
    Effect.provide(layer.pipe(Layer.provide(FetchHttpClient.layer))),
  )

  const summary = summaryOf(report)

  yield* Console.log(JSON.stringify({ ...summary, rows: usage }, null, 2))

  if (summary.problems.length > 0 || report.topics.some(({ problem }) => problem !== null))
    process.exitCode = 1
})

await Effect.runPromise(program)
