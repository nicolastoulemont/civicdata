import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

// Tests run inside workerd with the runtime the Worker deploys with. Keep in
// sync with the compatibility settings in packages/infra/alchemy.run.ts, plus
// the flag Alchemy adds by default.
export const runtime = {
  compatibilityDate: "2026-08-31",
  compatibilityFlags: ["new_module_registry"],
  // Local R2 buckets and D1 databases under the binding names packages/infra
  // gives the Worker. CATALOG_DB is a database of its own here, as it is
  // production's in a preview, so a test sees what requests write to it.
  r2Buckets: ["CACHE", "SERIES"],
  d1Databases: ["DB", "CATALOG_DB"],
}

export default defineConfig({
  plugins: [cloudflareTest({ miniflare: runtime })],
  test: {
    include: ["test/**/*.test.ts"],
    // Cloudflare inlines Vitest's cached module graph into one WebSocket
    // message, which can exceed workerd's message limit. Fetch modules alone.
    fsModuleCache: false,
  },
})
