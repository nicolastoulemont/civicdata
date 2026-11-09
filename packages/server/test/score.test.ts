import { Answered, Asked, IndicatorId, Ranking, Trend, Unanswered, Year } from "@civicdata/domain"
import { describe, expect, it } from "vitest"

import { Expected, score } from "../eval/score.ts"

const lifeExpectancy = IndicatorId.make("SP.DYN.LE00.IN")

// Life expectancy in Brazil and Mexico, 2005 to 2025: right for the case below
// unless a test changes it.
const trend = (changes: Partial<Trend> = {}) =>
  Answered.make({
    view: Trend.make({
      indicator: lifeExpectancy,
      countries: ["BRA", "MEX"],
      from: Year.make(2005),
      to: Year.make(2025),
      ...changes,
    }),
  })

const expected = Expected.Trend({ indicators: ["SP.DYN.LE00.IN"], countries: ["MEX", "BRA"] })

describe("score", () => {
  it("accepts the expected chart, with countries in any order and years the case leaves out", () => {
    expect(score([expected], trend())).toEqual([])
  })

  it("names each part of the chart that differs", () => {
    const answer = trend({
      indicator: IndicatorId.make("SP.DYN.IMRT.IN"),
      countries: ["BRA"],
      transform: "Index",
    })

    expect(score([{ ...expected, from: 2000 }], answer)).toEqual([
      "indicator SP.DYN.IMRT.IN, want SP.DYN.LE00.IN",
      "countries BRA, want MEX, BRA",
      "transform Index, want none",
      "from 2005, want 2000",
    ])
  })

  it("rejects a ranking where a trend is expected", () => {
    const ranking = Answered.make({
      view: Ranking.make({ indicator: lifeExpectancy, countries: ["BRA"], year: Year.make(2020) }),
    })

    expect(score([expected], ranking)).toEqual(["a ranking, want a trend"])
  })

  it("scores against the closest of the answers a case accepts", () => {
    const perPerson = Expected.Trend({ ...expected, transform: "PerPerson" })

    expect(score([perPerson, expected], trend())).toEqual([])
    expect(score([perPerson, Expected.Asked()], trend())).toEqual([
      "transform none, want PerPerson",
    ])
  })

  it("expects a question or no chart when the case says so", () => {
    const asked = Asked.make({ question: "Which GDP?", choices: ["Current", "Real"] })

    expect(score([Expected.Asked()], asked)).toEqual([])
    expect(score([Expected.Asked()], trend())).toEqual(["a trend, want a question"])
    expect(score([Expected.Unanswered()], Unanswered.make({}))).toEqual([])
    expect(score([Expected.Unanswered()], asked)).toEqual([
      'the question "Which GDP?", want no chart',
    ])
    expect(score([expected], Unanswered.make({}))).toEqual(["no chart, want a trend"])
  })
})
