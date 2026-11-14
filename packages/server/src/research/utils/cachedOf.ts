import { Option, Schema } from "effect"

import { Copy, type Work } from "../archive.schemas.ts"
import { cache } from "../constants/openalex/cache.ts"

// OpenAlex's cached PDF of a work, as a copy of its own, when OpenAlex holds
// one. OpenAlex does not say which location the file is of, so the copy
// takes the version, licence label and landing page of the location it
// names as the work's best open-access copy. The PDF's own notice is still
// the evidence.
export const cachedOf = (work: Work) => {
  const best = work.best_oa_location

  if (work.has_content?.pdf !== true || best === undefined || best === null) return undefined
  const id = work.id.replace("https://openalex.org/", "")

  return Option.getOrUndefined(
    Schema.decodeUnknownOption(Copy)({
      ...best,
      id: `openalex:content:${id}`,
      pdf_url: `https://${cache}/works/${id}.pdf`,
    }),
  )
}
