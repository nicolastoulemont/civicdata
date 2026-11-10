import { Evidence, Finding, IndicatorId, Scope, type Study, Year } from "@civicdata/domain"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Schema, Struct } from "effect"

import { Findings } from "../src/Findings.ts"

const krebs: Study = {
  authors: ["Krebs, Tom", "Scheffel, Martin"],
  year: 2013,
  title: "Macroeconomic Evaluation of Labor Market Reform in Germany",
  publisher: "IMF Working Paper 13/42",
  doi: null,
  url: "https://www.imf.org/external/pubs/ft/wp/2013/wp1342.pdf",
}

const launov: Study = {
  authors: ["Launov, Andrey", "Wälde, Klaus"],
  year: 2010,
  title: "Estimating Incentive and Welfare Effects of Non-Stationary Unemployment Benefits",
  publisher: "IZA Discussion Paper 4740",
  doi: null,
  url: "https://docs.iza.org/dp4740.pdf",
}

// A finding of one study, as findings.json writes it. Tests give it other
// evidence.
const finding = Schema.encodeSync(Finding)(
  Finding.make({
    id: "hartz-reforms",
    name: "a large effect of the Hartz reforms",
    claim: "The Hartz reforms caused much of the fall in German unemployment.",
    indicators: [IndicatorId.make("SL.UEM.TOTL.ZS")],
    scope: Scope.cases.Countries.make({ countries: ["DEU"] }),
    from: Year.make(2005),
    to: Year.make(2012),
    evidence: Evidence.cases.Single.make({ study: krebs }),
  }),
)

const single = Schema.encodeSync(Evidence.cases.Single)(
  Evidence.cases.Single.make({ study: krebs }),
)

const agreed = Schema.encodeSync(Evidence.cases.Agreed)(
  Evidence.cases.Agreed.make({ studies: [krebs, launov] }),
)

const disputed = Schema.encodeSync(Evidence.cases.Disputed)(
  Evidence.cases.Disputed.make({
    supporting: [krebs],
    disputing: [launov],
    objection: "Other studies find the reforms lowered unemployment only a little.",
  }),
)

// Whether findings.json's text for one finding decodes.
const decodes = (json: string) =>
  Exit.isSuccess(Schema.decodeUnknownExit(Schema.fromJsonString(Finding))(json))

describe("findings", () => {
  it("decodes a finding of one study, of agreeing studies and of a dispute", () => {
    const valid = [single, agreed, disputed].map((evidence) =>
      JSON.stringify({ ...finding, evidence }),
    )

    expect(valid.map(decodes)).toEqual([true, true, true])
  })

  it("rejects a finding with no study, or a dispute missing one side", () => {
    const invalid = [
      Struct.omit(single, ["study"]),
      { ...agreed, studies: [] },
      // Agreement takes two studies: one is a single study.
      { ...agreed, studies: [krebs] },
      { ...disputed, supporting: [] },
      { ...disputed, disputing: [] },
      Struct.omit(disputed, ["objection"]),
    ].map((evidence) => JSON.stringify({ ...finding, evidence }))

    expect(invalid.map(decodes)).toEqual(invalid.map(() => false))
  })

  it("rejects a study on both sides of a dispute", () => {
    expect(
      decodes(JSON.stringify({ ...finding, evidence: { ...disputed, disputing: [krebs] } })),
    ).toBe(false)
  })
})

describe("the seed findings", () => {
  // Decoding the shipped catalogue is part of building the layer: a finding
  // that breaks its state's rules fails here.
  it.effect("finds the Hartz reforms for German unemployment, and nothing for Japan", () =>
    Effect.gen(function* () {
      const findings = yield* Findings

      const covering = (countries: ReadonlyArray<"DEU" | "JPN">) =>
        findings
          .covering({
            indicator: IndicatorId.make("SL.UEM.TOTL.ZS"),
            countries,
            from: Year.make(2005),
            to: Year.make(2010),
          })
          .pipe(Effect.map((found) => found.map(({ id }) => id)))

      expect(yield* covering(["DEU"])).toContain("hartz-reforms")
      expect(yield* covering(["JPN"])).toEqual([])
    }).pipe(Effect.provide(Findings.layer)),
  )
})
