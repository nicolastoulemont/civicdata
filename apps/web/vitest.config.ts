import { defineConfig } from "vitest/config"

// Separate from vite.config.ts, so tests render components without the Start
// plugin's server build.
export default defineConfig({
  test: {
    environment: "happy-dom",
    // The app only calls its own origin (/api/...), so give the page one.
    // happy-dom preflights cross-origin requests, which the app never sends.
    environmentOptions: { happyDOM: { url: "http://localhost:3000" } },
    setupFiles: ["./test/setup.ts"],
  },
})
