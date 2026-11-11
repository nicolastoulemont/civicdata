import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import { NodeFileSystem } from "@effect/platform-node"
import { Console, Effect, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/http"

import { Digest } from "./evals/model.ts"
import { pack } from "./evals/pack.ts"
import { r2 } from "./evals/R2.ts"
import { list, pull, push } from "./evals/transfer.ts"

const help = `Offline:
  pnpm evals pack <run-folder> <new-archive-folder> [--label <name>] [--reviewer <model>]
Remote (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN; EVALS_BUCKET defaults to civicdata-evals):
  pnpm evals list
  pnpm evals push <archive-folder>
  pnpm evals pull <archive-id> <new-folder>

Paths are relative to your current directory. Pull restores the working files under <new-folder>/run.
Pack creates an immutable revision, preserving original files, vote-free answers and a separate review.
None of these commands runs an eval. Existing destinations are never overwritten.`

const remote = r2.pipe(Layer.provide(FetchHttpClient.layer))
const server = fileURLToPath(new URL("../", import.meta.url))

const Arguments = Schema.Union([
  Schema.Tuple([Schema.Literal("pack"), Schema.String, Schema.String]),
  Schema.Tuple([Schema.Literal("push"), Schema.String]),
  Schema.Tuple([Schema.Literal("pull"), Digest, Schema.String]),
  Schema.Tuple([Schema.Literal("list")]),
])

const printList = Effect.fn("Evals.printList")(function* () {
  for (const { id, manifest } of yield* list().pipe(Effect.provide(remote))) {
    yield* Console.log(`${id}\t${manifest.label}\t${manifest.reviews.length} reviews`)
  }
})

const execute = Effect.fn("Evals.execute")(function* (
  command: Exclude<typeof Arguments.Type, readonly ["pack", string, string]>,
) {
  switch (command[0]) {
    case "push": {
      return yield* push(resolve(command[1])).pipe(
        Effect.provide(remote),
        Effect.flatMap(Console.log),
      )
    }

    case "pull": {
      const manifest = yield* pull(command[1], resolve(command[2])).pipe(Effect.provide(remote))

      return yield* Console.log(`Restored ${manifest.label} to ${resolve(command[2])}/run`)
    }

    case "list": {
      return yield* printList()
    }
  }

  return yield* Effect.void
})

const program = Effect.gen(function* () {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { label: { type: "string" }, reviewer: { type: "string" }, help: { type: "boolean" } },
  })

  if (values.help || positionals.length === 0) return yield* Console.log(help)

  const command = yield* Schema.decodeUnknownEffect(Arguments)(positionals)

  if (command[0] === "pack") {
    const result = yield* pack(resolve(command[1]), {
      out: resolve(command[2]),
      server,
      label: values.label,
      reviewer: values.reviewer,
    })

    return yield* Console.log(result.id)
  }

  return yield* execute(command)
})

await Effect.runPromise(program.pipe(Effect.provide(NodeFileSystem.layer)))
