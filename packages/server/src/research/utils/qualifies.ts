import type { Copy } from "../archive.schemas.ts"
import { admitted } from "../constants/admitted.ts"
import { supported } from "./supported.ts"

// A copy worth downloading: one OpenAlex labels CC BY or public domain, or
// an EconStor item whose page may give its licence.
export const qualifies = (copy: Copy) => admitted.has(copy.license ?? "") || supported(copy)
