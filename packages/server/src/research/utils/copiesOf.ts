import { Option, Schema } from "effect"

import { Copy, type Work } from "../archive.schemas.ts"
import { pdfOf } from "./pdfOf.ts"
import { pmcidOf } from "./pmcidOf.ts"

// OpenAlex lists many PubMed Central copies without a PDF URL; the gather
// finds their PDF by PMC id, so such a copy gets PMC's address for it.
const located = (location: Work["locations"][number]) => {
  const pmcid = location.id === null || location.pdf_url !== null ? undefined : pmcidOf(location.id)

  return pmcid === undefined ? location : { ...location, pdf_url: pdfOf(pmcid) }
}

export const copiesOf = (work: Work) => {
  const copies = work.locations.flatMap((location) =>
    Option.toArray(Schema.decodeUnknownOption(Copy)(located(location))),
  )

  // A copy's native id, URL and version stay separate from the catalogue's
  // work/DOI grouping. Duplicate listing rows do not cause duplicate downloads.
  return [
    ...new Map(copies.map((copy) => [`${copy.id}|${copy.version}|${copy.pdf_url}`, copy])).values(),
  ]
}
