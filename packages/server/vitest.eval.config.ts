import { execFileSync } from "node:child_process"
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

// Every question spends OpenAI tokens and a run takes from 25 minutes to
// over an hour, so the eval and the probe run start only when someone asked
// for a run, never as a routine check.
if (process.env["RUN_AGENT_EVAL"] !== "1") {
  throw new Error(
    "The agent eval and probe run start only on request: they spend OpenAI tokens and take from 25 minutes to over an hour. Coding agents run them only when the user asked for a run in the current task, never to check their own change. To run one: RUN_AGENT_EVAL=1 pnpm --filter @civicdata/server eval (or probe)",
  )
}

// The key `alchemy dev` gets from `packages/infra/with-key.sh`: from the
// shell, else the Keychain. The settings in `packages/infra/.env` fill what is
// still unset.
const keychain = (): string | undefined => {
  try {
    const args = ["find-generic-password", "-s", "civicdata-dev", "-a", "OPENAI_API_KEY", "-w"]

    return execFileSync("security", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return undefined
  }
}

if ((process.env["OPENAI_API_KEY"] ?? "") === "") {
  const stored = keychain()

  if (stored !== undefined) process.env["OPENAI_API_KEY"] = stored
}

const keys = fileURLToPath(new URL("../infra/.env", import.meta.url))

if (existsSync(keys)) process.loadEnvFile(keys)

const key = process.env["OPENAI_API_KEY"]
const model = process.env["OPENAI_MODEL"]

if (key === undefined || key === "") {
  throw new Error(
    "The eval asks the model: store OPENAI_API_KEY in the Keychain (packages/infra/.env.example) or export it",
  )
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

// This run's folder for the probe run's answers (eval/probe.eval.ts), named
// by when it started. Made on the first answer written.
const run = fileURLToPath(
  new URL(`eval/runs/${new Date().toISOString().replaceAll(":", "-")}/`, import.meta.url),
)

// Writes one probe's answers into this run's folder.
const RUNS = async (request: Request) => {
  await mkdir(run, { recursive: true })
  await writeFile(join(run, new URL(request.url).pathname), await request.text())

  return new Response(null, { status: 204 })
}

// Asks the agent every question in eval/cases.ts (eval) or eval/probes.ts
// (probe), against OpenAI and the sources' recorded answers. Each question
// costs a few model requests, so this runs on request only, never in CI.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        ...runtime,
        serviceBindings: { RECORDINGS, RUNS },
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
