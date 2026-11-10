import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

// Tests run inside workerd with the runtime the Worker deploys with. Keep in
// sync with the compatibility settings in packages/infra/alchemy.run.ts, plus
// the flag Alchemy adds by default.
export const runtime = {
  compatibilityDate: "2026-08-31",
  compatibilityFlags: ["new_module_registry"],
  // Local R2 buckets and a D1 database under the binding names packages/infra gives the Worker.
  r2Buckets: ["CACHE", "SERIES"],
  d1Databases: ["DB"],
}

export default defineConfig({
  plugins: [cloudflareTest({ miniflare: runtime })],
  test: {
    // Vitest serves a module it already transformed from its file cache, and
    // the workers pool then sends @effect/ai-openai's 9 MB generated client to
    // workerd in one message too large for it: the second test file to load
    // the client crashed ("WebSocket protocol error: Message is too large").
    fsModuleCache: false,
  },
})
