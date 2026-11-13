import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import { NodeFileSystem } from "@effect/platform-node"
import { Clock, Effect, Layer } from "effect"
import { HttpClient } from "effect/http"

import * as Fetch from "../src/Fetch.ts"
import { Licences } from "./papers/licences.ts"
import { OpenAlex } from "./papers/openalex.ts"
import { collect } from "./papers/run.ts"
import { Papers } from "./papers/storage.ts"

const { values } = parseArgs({
  options: {
    output: {
      type: "string",
      default: fileURLToPath(new URL("../../../.papers/corpus-v4", import.meta.url)),
    },
    refresh: { type: "boolean", default: false },
    offline: { type: "boolean", default: false },
    seeds: { type: "boolean", default: false },
  },
})

if (values.refresh && values.offline) throw new Error("Choose --refresh or --offline")

const mode = values.offline ? "Offline" : values.refresh ? "Refresh" : "Resume"

const usage = { requests: 0 }

const transport = Layer.effect(
  HttpClient.HttpClient,
  Effect.map(HttpClient.HttpClient, (client) =>
    client.pipe(
      HttpClient.mapRequestEffect((request) =>
        Effect.sync(() => {
          usage.requests += 1

          return request
        }),
      ),
    ),
  ),
).pipe(Layer.provide(Fetch.layer))

const program = Effect.gen(function* () {
  const started = yield* Clock.currentTimeMillis
  const report = yield* collect(values.output, { mode, corpus: values.seeds ? "Seeds" : "Topics" })

  // The report contains bibliography and evidence, never paper passages.
  console.log(
    JSON.stringify(
      {
        format: 3,
        ...report,
        elapsedMs: (yield* Clock.currentTimeMillis) - started,
        requests: usage.requests,
      },
      null,
      2,
    ),
  )

  if (report.unresolved > 0) process.exitCode = 1
})

await Effect.runPromise(
  program.pipe(
    Effect.provide(
      Layer.mergeAll(Papers.files(values.output), OpenAlex.layer, Licences.layer).pipe(
        Layer.provide(transport),
        // Discovery itself also reads and writes its checkpoint through FileSystem.
        Layer.provideMerge(NodeFileSystem.layer),
      ),
    ),
  ),
)
