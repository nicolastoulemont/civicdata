import { createHash } from "node:crypto"

import { Schema } from "effect"

interface Download {
  readonly source: string
  readonly sha256: string
}

// The response's bytes identify the boundary release before its reader decodes JSON.
export const download = async <A>(
  schema: Schema.Decoder<A>,
  { source, sha256 }: Download,
): Promise<A> => {
  const response = await fetch(source)

  if (!response.ok) throw new Error(`Boundary download: HTTP ${response.status} from ${source}`)
  const bytes = Buffer.from(await response.arrayBuffer())

  if (createHash("sha256").update(bytes).digest("hex") !== sha256)
    throw new Error(`Pinned boundary response changed: ${source}`)

  return Schema.decodeUnknownSync(schema)(JSON.parse(bytes.toString("utf8")))
}
