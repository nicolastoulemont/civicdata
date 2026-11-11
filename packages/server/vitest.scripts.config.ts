import { defineConfig } from "vitest/config"

// Archive tooling runs in Node; it never loads the paid eval config or workerd.
export default defineConfig({ test: { include: ["scripts/**/*.test.ts"] } })
