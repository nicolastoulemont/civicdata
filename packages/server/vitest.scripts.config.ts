import { defineConfig } from "vitest/config"

// Archive tooling runs in Node; it never loads the paid eval config or workerd.
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts"],
    // Tests of failing inputs log the warnings they expect. Print a test's logs
    // only when it fails, as Vitest already does when it detects an agent.
    silent: "passed-only",
  },
})
