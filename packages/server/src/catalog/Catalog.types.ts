import type { Array as Arr } from "effect"

import type { Dimension, Outline } from "../series/Outline.schemas.ts"

// A dataset's outline as search hands it over: each code of its dimensions
// with its label, or the code itself while it has none.
export interface Labelled extends Omit<Outline, "dimensions"> {
  readonly dimensions: ReadonlyArray<{
    readonly id: Dimension["id"]
    readonly codes: Arr.NonEmptyReadonlyArray<{ readonly code: string; readonly label: string }>
  }>
}
