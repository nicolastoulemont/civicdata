import { createHash } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import type { Artifact } from "../src/archive.ts"
import { url } from "../src/archive.ts"

export const verify = (artifact: Artifact, bytes: Uint8Array) => {
  const hash = createHash("sha256").update(bytes).digest("hex")

  if (bytes.length !== artifact.bytes || hash !== artifact.sha256)
    throw new Error(`Map artifact checksum mismatch: ${artifact.path}`)
}

export const restore = async (artifact: Artifact, directory: string) => {
  const file = join(directory, artifact.path)

  try {
    verify(artifact, await readFile(file))

    return
  } catch {
    // Missing or damaged cache entries are replaced only with verified bytes.
  }

  const response = await fetch(url(artifact))

  if (!response.ok) throw new Error(`Map artifact HTTP ${response.status}: ${artifact.path}`)
  const bytes = new Uint8Array(await response.arrayBuffer())

  verify(artifact, bytes)
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`

  await writeFile(temporary, bytes)
  await rename(temporary, file)
}
