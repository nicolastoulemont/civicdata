import { expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

import { Turn } from "../src/Conversation.ts"
import { identify, IndicatorId, NativeId, nativeId, Source, sourceOf } from "../src/Source.ts"

it.effect("decodes deployed conversation charts without renaming their indicators", () =>
  Effect.gen(function* () {
    for (const [indicator, source] of [
      ["SP.POP.TOTL", "World Bank"],
      ["ESTAT,UNE_RT_A,1.0", "Eurostat"],
      ["OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0", "OECD"],
    ] as const) {
      const stored = JSON.parse(
        `{"question":"Compare France","answer":{"_tag":"Answered","blocks":[{"_tag":"Chart","view":{"_tag":"Trend","indicator":"${indicator}","countries":["FRA"],"from":2000,"to":2020}}]}}`,
      )

      const turn = yield* Schema.decodeUnknownEffect(Turn)(stored)
      expect(yield* Schema.encodeEffect(Turn)(turn)).toEqual(stored)
      expect(sourceOf(IndicatorId.make(indicator))).toBe(source)
    }
  }),
)

it("distinguishes the same native code at different publishers and rejects ambiguous ids", () => {
  const native = NativeId.make("SP.POP.TOTL")
  expect(identify("World Bank", native)).toBe("SP.POP.TOTL")
  const fourth = identify(Source.make("Fixture"), native)
  expect(sourceOf(fourth)).toBe("Fixture")
  expect(nativeId(fourth)).toBe(native)

  for (const id of [
    "OTHER,FLOW,1.0",
    "Fixture:",
    "Fixture:../code",
    "OECD:CODE",
    "World Bank:CODE",
  ]) {
    expect(Schema.is(IndicatorId)(id)).toBe(false)
  }

  expect(() => identify("OECD", native)).toThrow("Native code does not belong to OECD")
})
