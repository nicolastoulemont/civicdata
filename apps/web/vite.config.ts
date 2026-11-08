import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Alchemy adds its Cloudflare plugin when it builds or runs this app, so the
// config stays runtime-neutral. Do not add @cloudflare/vite-plugin here.
export default defineConfig({
  plugins: [tanstackStart(), react()],
})
