import type { EurostatCodelists } from "../parse.schemas.ts"
import type { Labels } from "../parse.types.ts"

// Eurostat's codelists: every one at once (58 MB), or one.
export const eurostatLabels = (decoded: typeof EurostatCodelists.Type): Labels =>
  new Map(
    ("link" in decoded ? decoded.link.item : [decoded]).map(({ category, extension }) => [
      `ESTAT:${extension.id}`,
      new Map(Object.entries(category.label)),
    ]),
  )
