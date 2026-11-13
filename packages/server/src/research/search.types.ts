import type { Annotation } from "./annotation.schemas.ts"
import type { Copy, Evidence, Passage, Seed } from "./archive.schemas.ts"

// What search reads of an annotated paper: a gathered corpus entry, or a
// paper the store holds with its active annotation.
export interface Annotated {
  readonly paper: {
    readonly seed: Pick<Seed, "id" | "study">
    readonly content: {
      // The copy's id in the store.
      readonly id: string
      readonly copy: Pick<Copy, "id" | "version">
      readonly sha256: string
      readonly url: string
      readonly evidence: ReadonlyArray<Evidence>
      readonly passages: ReadonlyArray<typeof Passage.Type>
    }
  }
  readonly annotation: Pick<typeof Annotation.Type, "scope" | "labels" | "excerpts">
}
