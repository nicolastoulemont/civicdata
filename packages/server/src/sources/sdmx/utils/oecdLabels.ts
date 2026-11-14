import type { Codelist } from "../../../series/Outline.schemas.ts"
import type { OecdCodelists } from "../parse.schemas.ts"
import type { Labels } from "../parse.types.ts"

// The OECD's codelists: every one at once (33 MB), or one.
export const oecdLabels = ({ data }: typeof OecdCodelists.Type): Labels => {
  const labels = new Map<Codelist, Map<string, string>>()

  for (const { agencyID, id, codes = [] } of data.codelists) {
    const key = `${agencyID}:${id}`
    const known = labels.get(key) ?? new Map<string, string>()

    for (const code of codes) known.set(code.id, code.name)

    labels.set(key, known)
  }

  return labels
}
