import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Alchemy adds its Cloudflare plugin when it builds or runs this app, so the
// config stays runtime-neutral. Do not add @cloudflare/vite-plugin here.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  // Provided by the Workers runtime. Outside Workers the server's dynamic
  // import of it fails and the R2 cache is skipped (see packages/server Cache).
  build: { rolldownOptions: { external: ["cloudflare:workers"] } },
  plugins: [tailwindcss(), tanstackStart(), react()],
})
