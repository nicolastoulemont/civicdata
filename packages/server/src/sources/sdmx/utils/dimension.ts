import { Code, DimensionId } from "@repo/domain"
import { Array as Arr, Option, Schema } from "effect"

import type { Codelist } from "../../../series/Outline.schemas.ts"

const isCode = Schema.is(Code)
const isDimension = Schema.is(DimensionId)

// A dimension's codes as an outline stores them: the ones a code can be, each
// once, or none when no code is.
export const dimension = (id: string, codelist: Codelist | null, codes: Iterable<string>) => {
  const kept = [...new Set(codes)].filter(isCode)

  return isDimension(id) && Arr.isArrayNonEmpty(kept)
    ? Option.some({ id, codelist, codes: kept })
    : Option.none()
}
