import { expect, it } from "@effect/vitest"
import { strToU8, unzipSync, zipSync } from "fflate"

it("probe: fflate round-trips a zip", () => {
  expect(unzipSync(zipSync({ a: strToU8("x") }))["a"]?.length).toBe(1)
})
