import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

// Tests run inside workerd with the runtime the Worker deploys with. Keep in
// sync with the compatibility settings in packages/infra/alchemy.run.ts, plus
// the flag Alchemy adds by default.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-08-31",
        compatibilityFlags: ["new_module_registry"],
        // A local R2 bucket and D1 database under the binding names packages/infra gives the Worker.
        r2Buckets: ["CACHE"],
        d1Databases: ["DB"],
      },
    }),
  ],
})
