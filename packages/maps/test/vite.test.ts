import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { build, createServer } from "vite"
import { describe, expect, it } from "vitest"

import { artifacts, url as artifactUrl } from "../src/archive.ts"
import { boundaries } from "../src/vite.ts"

const downloads = artifacts.filter((artifact) => artifact.path.startsWith("downloads/"))

describe("boundary downloads", () => {
  it("redirects the existing development URL to its pinned archive", async () => {
    const server = await createServer({
      configFile: false,
      logLevel: "silent",
      plugins: [boundaries()],
      server: { port: 0 },
    })

    try {
      await server.listen()
      const origin = server.resolvedUrls?.local[0]

      if (origin === undefined) throw new Error("Missing development server address")
      const url = new URL("/boundaries/CUW.zip", origin)
      const artifact = downloads.find((file) => file.path === "downloads/CUW.zip")

      if (artifact === undefined) throw new Error("Missing Curaçao download")
      const response = await fetch(url, { redirect: "manual" })

      expect(response.status).toBe(302)
      expect(response.headers.get("location")).toBe(artifactUrl(artifact))
      expect((await response.arrayBuffer()).byteLength).toBe(0)

      const head = await fetch(url, { method: "HEAD", redirect: "manual" })

      expect(head.status).toBe(302)
      expect(head.headers.get("location")).toBe(response.headers.get("location"))
      expect((await fetch(new URL("/boundaries/ZZZ.zip", origin))).status).toBe(404)
    } finally {
      await server.close()
    }
  })

  it("builds aliases for every pinned archive without fetching its bytes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "maps-build-"))

    try {
      await build({
        configFile: false,
        logLevel: "silent",
        plugins: [boundaries()],
        build: {
          outDir: directory,
          minify: false,
          rolldownOptions: {
            input: fileURLToPath(new URL("../src/index.ts", import.meta.url)),
            external: ["@repo/domain"],
          },
        },
      })

      const redirects = readFileSync(join(directory, "_redirects"), "utf8").trim().split("\n")

      expect(redirects).toHaveLength(downloads.length)
      expect(existsSync(join(directory, "boundaries"))).toBe(false)

      for (const artifact of downloads)
        expect(redirects).toContain(
          `/boundaries/${artifact.path.slice("downloads/".length)} ${artifactUrl(artifact)} 302`,
        )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 30_000)
})
