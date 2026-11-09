import { expect, it } from "@effect/vitest"

import { recorded } from "./politics.ts"

it("probe: the test helper loads and zips", () => {
  expect(Object.keys(recorded())).toHaveLength(5)
})
