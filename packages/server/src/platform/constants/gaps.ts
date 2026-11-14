import { Duration } from "effect"

import type { Gaps } from "../Pace.types.ts"

export const gaps: Gaps = {
  gap: Duration.seconds(2),
  hosts: {
    "api.openalex.org": Duration.seconds(1),
    "pmc-oa-opendata.s3.amazonaws.com": Duration.millis(250),
  },
}
