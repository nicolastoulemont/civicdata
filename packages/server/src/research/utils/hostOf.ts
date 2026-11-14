import type { Copy } from "../archive.schemas.ts"
import { bucket } from "../constants/pmc/bucket.ts"
import { articleOf } from "./articleOf.ts"

// The host the gather asks for a copy's PDF: PMC's bucket for a PubMed
// Central copy, the PDF URL's host for any other.
export const hostOf = (copy: Copy) =>
  articleOf(copy) === undefined ? new URL(copy.pdf_url).host : bucket
