import type { Indicator } from "@repo/domain"

import { titles } from "../titles.gen.ts"
import { fits } from "./fits.ts"

// The chart's heading: the indicator's plain title, or its official name when
// it has none, or when the source renamed it so that the title no longer fits.
export const titleOf = (indicator: typeof Indicator.Type) => {
  const title = titles.get(indicator.id)

  return title !== undefined && fits(title, indicator.name) ? title : indicator.name
}
