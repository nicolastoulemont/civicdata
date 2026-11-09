import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

import { runtime } from "./vitest.config.ts"

// The key `alchemy dev` reads. A variable exported in the shell overrides it.
const keys = fileURLToPath(new URL("../infra/.env", import.meta.url))

if (existsSync(keys)) process.loadEnvFile(keys)

const key = process.env["OPENAI_API_KEY"]
const model = process.env["OPENAI_MODEL"]

if (key === undefined || key === "") {
  throw new Error("The eval asks the model: set OPENAI_API_KEY, e.g. in packages/infra/.env")
}

// Asks the agent every question in eval/cases.ts, against the live World Bank
// and OpenAI. Each question costs a few model requests, so this runs by hand,
// never in CI.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        ...runtime,
        bindings:
          model === undefined
            ? { OPENAI_API_KEY: key }
            : { OPENAI_API_KEY: key, OPENAI_MODEL: model },
      },
    }),
  ],
  // The World Bank stalls on some requests when asked many at once.
  test: { include: ["eval/**/*.eval.ts"], testTimeout: 180_000, maxConcurrency: 2 },
})
