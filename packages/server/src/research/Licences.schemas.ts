import { Schema } from "effect"

import { Evidence } from "./archive.schemas.ts"

export const PageCheck = Schema.TaggedUnion({
  Unknown: {},
  Denied: {},
  Allowed: { evidence: Evidence },
})
