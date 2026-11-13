import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Schema } from "effect"
import { http, HttpResponse } from "msw/http"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import { countryMaps } from "../scripts/countries.ts"
import { restore } from "../scripts/transfer.ts"
import { Artifact, artifacts, url } from "../src/archive.ts"

const bytes = new TextEncoder().encode("pinned map geometry")

const artifact = Schema.decodeSync(Artifact)({
  path: "sources/example.json",
  sha256: createHash("sha256").update(bytes).digest("hex"),
  bytes: bytes.length,
})

const endpoint = url(artifact).replace(/\?.*$/, "")

const network = setupServer()
const directories: Array<string> = []

const directory = () => {
  const root = mkdtempSync(join(tmpdir(), "map-restore-"))

  directories.push(root)

  return root
}

beforeAll(() => network.listen({ onUnhandledFrame: "error" }))

afterEach(() => {
  network.resetHandlers()

  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true })
})

afterAll(() => network.close())

describe("pinned map restoration", () => {
  it("pins one source snapshot for every registered country", () => {
    const sources = artifacts.flatMap((file) =>
      file.path.startsWith("sources/") ? [file.path] : [],
    )

    const expected = countryMaps.map(
      (map) =>
        `sources/${map.id}.json${map.source === "Boundary" || map.source === "LandBoard" ? ".gz" : ""}`,
    )

    expect(sources.toSorted()).toEqual(expected.toSorted())
    expect(new Set(artifacts.map((file) => file.path)).size).toBe(artifacts.length)
  })

  it("writes verified remote bytes to the local cache", async () => {
    const root = directory()

    network.use(http.get(endpoint, () => HttpResponse.arrayBuffer(bytes.buffer)))
    await restore(artifact, root)
    expect(readFileSync(join(root, artifact.path))).toEqual(Buffer.from(bytes))
  })

  it("uses a verified cache without network access", async () => {
    const root = directory()

    mkdirSync(join(root, "sources"))
    writeFileSync(join(root, artifact.path), bytes)
    await restore(artifact, root)
    expect(readFileSync(join(root, artifact.path))).toEqual(Buffer.from(bytes))
  })

  it("replaces a damaged cache with verified bytes", async () => {
    const root = directory()

    mkdirSync(join(root, "sources"))
    writeFileSync(join(root, artifact.path), "damaged")
    network.use(http.get(endpoint, () => HttpResponse.arrayBuffer(bytes.buffer)))
    await restore(artifact, root)
    expect(readFileSync(join(root, artifact.path))).toEqual(Buffer.from(bytes))
  })

  it("does not persist a corrupt download", async () => {
    const root = directory()

    network.use(http.get(endpoint, () => HttpResponse.text("corrupt")))
    await expect(restore(artifact, root)).rejects.toThrow("checksum mismatch")
    expect(existsSync(join(root, artifact.path))).toBe(false)
  })

  it("reports a missing remote artifact", async () => {
    network.use(http.get(endpoint, () => new HttpResponse(null, { status: 404 })))
    await expect(restore(artifact, directory())).rejects.toThrow("HTTP 404")
  })
})
