import { createHash } from "node:crypto"
import { readFile, writeFile, readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { Config, Effect, Redacted, Schema } from "effect"

import { Archive, artifacts, url } from "../src/archive.ts"
import { restore, verify } from "./transfer.ts"

const cache = new URL("../.archive/", import.meta.url)
const manifest = new URL("../src/archive.json", import.meta.url)

const command = Schema.decodeUnknownSync(Schema.Literals(["pin", "restore", "publish", "verify"]))(
  process.argv[2],
)

if (command === "pin") {
  const files = []

  // Explicit pinning is the only command that changes recorded checksums.
  // eslint-disable-next-line no-await-in-loop
  for (const folder of ["sources", "downloads"]) {
    const directory = new URL(`${folder}/`, cache)

    // eslint-disable-next-line no-await-in-loop
    for (const name of (await readdir(directory)).toSorted()) {
      // eslint-disable-next-line no-await-in-loop
      const bytes = await readFile(new URL(name, directory))

      files.push({
        path: `${folder}/${name}`,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      })
    }
  }

  const data = Schema.decodeSync(Archive)({ origin: "https://maps.openfacts.app", files })

  await writeFile(manifest, `${JSON.stringify(data, null, 2)}\n`)
} else {
  const credentials =
    command !== "publish"
      ? undefined
      : Effect.runSync(
          Effect.gen(function* () {
            return {
              account: yield* Config.schema(
                Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/)),
                "CLOUDFLARE_ACCOUNT_ID",
              ),
              token: yield* Config.Redacted("CLOUDFLARE_API_TOKEN"),
            }
          }),
        )

  // Sequential files bound memory; every stored object is addressed by its bytes.
  // eslint-disable-next-line no-await-in-loop
  for (const artifact of artifacts) {
    if (command === "restore") {
      if (!artifact.path.startsWith("sources/")) continue
      // eslint-disable-next-line no-await-in-loop
      await restore(artifact, fileURLToPath(cache))
    } else if (credentials !== undefined) {
      // eslint-disable-next-line no-await-in-loop
      const bytes = new Uint8Array(await readFile(new URL(artifact.path, cache)))

      verify(artifact, bytes)
      const key = new URL(url(artifact)).pathname
      const target = `https://api.cloudflare.com/client/v4/accounts/${credentials.account}/r2/buckets/openfacts-maps/objects${key}`
      const headers = { Authorization: `Bearer ${Redacted.value(credentials.token)}` }
      // eslint-disable-next-line no-await-in-loop
      const found = await fetch(target, { headers })

      if (found.status === 404) {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(target, {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/octet-stream" },
          body: bytes,
        })

        if (!response.ok) throw new Error(`Map upload HTTP ${response.status}: ${artifact.path}`)
      } else {
        if (!found.ok) throw new Error(`Map archive HTTP ${found.status}: ${artifact.path}`)
        // eslint-disable-next-line no-await-in-loop
        verify(artifact, new Uint8Array(await found.arrayBuffer()))
      }

      // Read back every upload before declaring it migrated.
      // eslint-disable-next-line no-await-in-loop
      const stored = await fetch(target, { headers })

      if (!stored.ok) throw new Error(`Map readback HTTP ${stored.status}: ${artifact.path}`)
      // eslint-disable-next-line no-await-in-loop
      verify(artifact, new Uint8Array(await stored.arrayBuffer()))
    } else {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(url(artifact))

      if (!response.ok) throw new Error(`Map archive HTTP ${response.status}: ${artifact.path}`)
      // eslint-disable-next-line no-await-in-loop
      verify(artifact, new Uint8Array(await response.arrayBuffer()))
    }

    process.stdout.write(`${command}: ${artifact.path}\n`)
  }
}
