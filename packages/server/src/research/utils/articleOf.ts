import type { Copy } from "../archive.schemas.ts"
import type { Article } from "../pmc.types.ts"
import { pmcidOf } from "./pmcidOf.ts"

// The article of a PubMed Central copy.
export const articleOf = (copy: Copy): Article | undefined => {
  const pmcid = pmcidOf(copy.id)

  return pmcid === undefined ? undefined : { pmcid, manuscript: copy.version === "acceptedVersion" }
}
