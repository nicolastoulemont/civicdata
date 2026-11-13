import type { Plugin } from "vite"

import { artifacts, url } from "./archive.ts"

// Public aliases keep working without downloading the archives during a build.
export const boundaries = (): Plugin => {
  const files = artifacts.filter((artifact) => artifact.path.startsWith("downloads/"))

  const redirects = new Map(
    files.map((artifact) => [
      `/boundaries/${artifact.path.slice("downloads/".length)}`,
      url(artifact),
    ]),
  )

  return {
    name: "maps:boundaries",
    configureServer: (server) => {
      server.middlewares.use((request, response, next) => {
        const location = redirects.get(request.url?.split("?")[0] ?? "")

        if (location === undefined || (request.method !== "GET" && request.method !== "HEAD")) {
          next()

          return
        }

        response.statusCode = 302
        response.setHeader("Location", location)
        response.end()
      })
    },
    generateBundle() {
      const source = [...redirects].map(([path, location]) => `${path} ${location} 302`).join("\n")

      this.emitFile({ type: "asset", fileName: "_redirects", source: `${source}\n` })
    },
  }
}
