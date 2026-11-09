import { expect, it } from "@effect/vitest"

import { Archives } from "../src/Archives.ts"

it("probe: Archives loads", () => {
  expect(Archives.layer).toBeDefined()
})
