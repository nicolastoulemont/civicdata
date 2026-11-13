// Manual operation: publishes a gathered corpus to the paper store of the
// stage whose database and bucket the person running it names, or withdraws
// one copy's text. docs/papers.md describes both. No model is asked.
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import { NodeFileSystem } from "@effect/platform-node"
import { Config, Console, Effect, Layer, Schema } from "effect"

import * as Fetch from "../src/platform/Fetch.ts"
import { Bucket } from "../src/research/Bucket.ts"
import { withdraw } from "../src/research/publication.ts"
import { Withdrawal } from "../src/research/store.ts"
import { d1 } from "./d1.ts"
import { Publication, publish } from "./papers/publish.ts"

const { values } = parseArgs({
  options: {
    corpus: {
      type: "string",
      default: fileURLToPath(new URL("../../../.papers/corpus-v4", import.meta.url)),
    },
    withdraw: { type: "string" },
    reason: { type: "string" },
  },
})

if ((values.withdraw === undefined) !== (values.reason === undefined))
  throw new Error("Supply both --withdraw <copy> and --reason Rights|Retraction")

const target = Effect.gen(function* () {
  const account = yield* Config.String("CLOUDFLARE_ACCOUNT_ID")
  const token = yield* Config.Redacted("CLOUDFLARE_API_TOKEN")
  const database = yield* Config.String("PAPERS_D1_ID")
  const bucket = yield* Config.String("PAPERS_R2_BUCKET")
  const store = d1({ account, database, token })

  return {
    usage: store.usage,
    layer: Layer.mergeAll(store.layer, Bucket.r2({ account, bucket, token })).pipe(
      Layer.provide(Fetch.layer),
    ),
  }
})

// The report names papers and outcomes, never passages.
const corpus = (directory: string) =>
  Effect.gen(function* () {
    const { usage, layer } = yield* target
    const results = yield* publish(directory).pipe(Effect.provide(layer))

    const count = (tag: "Unchanged" | "Written" | "Failed") =>
      results.filter(({ outcome }) => Publication.$is(tag)(outcome)).length

    const report = {
      papers: results.length,
      unchanged: count("Unchanged"),
      written: count("Written"),
      failed: count("Failed"),
      rows: usage,
      changes: results.filter(({ outcome }) => !Publication.$is("Unchanged")(outcome)),
    }

    yield* Console.log(JSON.stringify(report, null, 2))

    if (count("Failed") > 0) process.exitCode = 1
  })

const copy = (id: string, reason: string) =>
  Effect.gen(function* () {
    const { layer } = yield* target
    const decoded = yield* Schema.decodeUnknownEffect(Withdrawal)(reason)

    const withdrawn = yield* withdraw(id, { reason: decoded }).pipe(Effect.provide(layer))

    yield* Console.log(JSON.stringify(withdrawn, null, 2))
  })

const program: Effect.Effect<void, unknown> =
  values.withdraw === undefined || values.reason === undefined
    ? corpus(values.corpus).pipe(Effect.provide(NodeFileSystem.layer))
    : copy(values.withdraw, values.reason)

await Effect.runPromise(program)
