import { expect, it } from "@effect/vitest"

// Fails on purpose so the probe never deploys a preview.
it("probe: blocks deploys", () => {
  expect("probe").toBe("not deployable")
})
