import { defineConfig } from "vitest/config"

// Separate from vite.config.ts, so tests render components without the Start
// plugin's server build.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    // Provided by the Workers runtime, as in vite.config.ts. A page test that
    // imports a route reaches the server, whose dynamic import of it fails and
    // falls back, as in Node.
    {
      name: "cloudflare-workers-external",
      resolveId: (id) => (id === "cloudflare:workers" ? { id, external: true } : null),
    },
  ],
  test: {
    // happy-dom, with its console errors routed to the test that caused them.
    environment: "./test/environment.ts",
    // The app only calls its own origin (/api/...), so give the page one.
    // happy-dom preflights cross-origin requests, which the app never sends.
    environmentOptions: { happyDOM: { url: "http://localhost:3000" } },
    setupFiles: ["./test/setup.ts"],
    // Tests of failed requests log the failures they expect, and Recharts warns
    // about every chart happy-dom gives no size. Print a test's logs only when
    // it fails, as Vitest already does when it detects an agent.
    silent: "passed-only",
  },
})
