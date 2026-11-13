import { readFileSync } from "node:fs"

import { Country } from "@repo/domain"
import { Effect, Result } from "effect"
import { expect, it } from "vitest"

import { record } from "./imf-record.ts"

const text = readFileSync(new URL("../../../docs/research/imf/FRA.csv", import.meta.url), "utf8")
const options = { country: Country.make("FRA"), vintage: "2026-10-13T02:00:00Z" }

it("preserves missing numbers and an all-estimate cutoff without substituting zero", async () => {
  const result = await Effect.runPromise(
    record(
      text.replace("2020,-7.607135", "2020,").replaceAll(",2025,National", ",0,National"),
      options,
    ),
  )

  expect(result.observations).toHaveLength(10)
  expect(result.qualifications[0]).toMatchObject({
    missing: true,
    latestActual: 0,
    status: { code: "EstimateProjection" },
  })
  expect(result.qualifications.every((item) => item.status?.code === "EstimateProjection")).toBe(
    true,
  )
})

it.each([
  [",FRA,", ",SWE,"],
  [",PT,", ",PD,"],
  [",2025,National", ",unknown,National"],
  ["2020,-7.607135", "2021,-7.607135"],
  ["2020,-7.607135", "2020,NaN"],
  ["2020,-7.607135", "2020,1junk"],
])("rejects invalid publisher fields %s", async (before, after) => {
  const result = await Effect.runPromise(
    record(text.replaceAll(before, after), options).pipe(Effect.result),
  )

  expect(Result.isFailure(result)).toBe(true)
})
