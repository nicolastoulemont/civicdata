import { expect, it } from "@effect/vitest"

import { Politics } from "../src/Politics.ts"
import { PoliticsBuild } from "../src/PoliticsBuild.ts"

it("probe: Politics and PoliticsBuild load", () => {
  expect([Politics.layer, PoliticsBuild.layer]).toHaveLength(2)
})
