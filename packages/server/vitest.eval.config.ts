import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { gunzip, gzip } from "node:zlib"

import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

import { runtime } from "./vitest.config.ts"

// Every case spends OpenAI tokens and a run takes about 25 minutes, so the
// eval starts only when someone asked for a run, never as a routine check.
if (process.env["RUN_AGENT_EVAL"] !== "1") {
  throw new Error(
    "The agent eval runs only on request: it spends OpenAI tokens and takes about 25 minutes. Coding agents run it only when the user asked for an eval run in the current task, never to check their own change. To run it: RUN_AGENT_EVAL=1 pnpm --filter @civicdata/server eval",
  )
}

// The key `alchemy dev` reads. A variable exported in the shell overrides it.
const keys = fileURLToPath(new URL("../infra/.env", import.meta.url))

if (existsSync(keys)) process.loadEnvFile(keys)

const key = process.env["OPENAI_API_KEY"]
const model = process.env["OPENAI_MODEL"]

if (key === undefined || key === "") {
  throw new Error("The eval asks the model: set OPENAI_API_KEY, e.g. in packages/infra/.env")
}

const recordings = fileURLToPath(new URL("eval/recordings", import.meta.url))

// The sources' recorded answers (eval/Recordings.ts), one gzipped file per
// request, read and written from Node for the eval inside workerd.
const RECORDINGS = async (request: Request) => {
  const file = `${join(recordings, new URL(request.url).pathname)}.gz`

  if (request.method !== "PUT")
    return readFile(file).then(
      async (zipped) => new Response(await promisify(gunzip)(zipped)),
      () => new Response(null, { status: 404 }),
    )

  // Two cases can record the same answer at once: each writes its own file
  // and the last rename wins.
  const written = `${file}.${randomUUID()}`

  await mkdir(dirname(file), { recursive: true })
  await writeFile(written, await promisify(gzip)(await request.text()))
  await rename(written, file)

  return new Response(null, { status: 204 })
}

// Asks the agent every question in eval/cases.ts, against OpenAI and the
// sources' recorded answers. Each question costs a few model requests, so
// this runs on request only, never in CI.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        ...runtime,
        serviceBindings: { RECORDINGS },
        bindings:
          model === undefined
            ? { OPENAI_API_KEY: key }
            : { OPENAI_API_KEY: key, OPENAI_MODEL: model },
      },
    }),
  ],
  // The World Bank stalls on some requests when asked many at once. A case
  // that asks the OECD live waits up to three minutes for its request budget
  // (agent.eval.ts).
  // The run prints what it asked of each source, which a passing run would
  // otherwise hide.
  test: {
    include: ["eval/**/*.eval.ts"],
    testTimeout: 360_000,
    maxConcurrency: 2,
    silent: false,
  },
})
