import type { Labels } from "../annotation.schemas.ts"
import type { Passage } from "../archive.schemas.ts"
import { keyOf } from "./keyOf.ts"

export const complete = (
  labels: typeof Labels.Type,
  passages: ReadonlyArray<typeof Passage.Type>,
) => {
  const expected = new Set(passages.map(keyOf))

  return (
    labels.length === expected.size &&
    new Set(labels.map(keyOf)).size === expected.size &&
    labels.every((label) => expected.has(keyOf(label)))
  )
}
