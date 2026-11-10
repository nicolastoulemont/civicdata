import {
  AgentUnavailable,
  Answered,
  Chart,
  Asked,
  IndicatorId,
  Stopped,
  Trend,
  type Turn,
  TurnIndex,
  Unanswered,
  Year,
} from "@civicdata/domain"
import { describe, expect, it } from "vitest"

import { inView, preview } from "./rail.ts"
import { Entry } from "./timeline.ts"

const question = "Life expectancy in Brazil"

const view = Trend.make({
  indicator: IndicatorId.make("SP.DYN.LE00.IN"),
  countries: ["BRA"],
  from: Year.make(2000),
  to: Year.make(2001),
})

const turn = (answer: Turn["answer"]) =>
  Entry.Turn({ turn: { question, answer }, index: TurnIndex.make(0) })

describe("rail preview", () => {
  it("starts an answer with the agent's question back, or how it ended", () => {
    expect(
      preview(turn(Asked.make({ question: "Which Georgia?", choices: ["The US state"] }))),
    ).toEqual({ question, answer: "Which Georgia?" })
    expect(preview(turn(Unanswered.make({})))).toEqual({ question, answer: "No data found" })
    expect(preview(turn(Stopped.make({})))).toEqual({ question, answer: "Stopped" })
  })

  it("shows only the question of an answer without words", () => {
    expect(preview(turn(Answered.make({ blocks: [Chart.make({ view })] })))).toEqual({
      question,
      answer: undefined,
    })
  })

  it("starts a failed question's answer with why it failed", () => {
    const failed = Entry.Failed({
      failure: { question, steps: [], error: new AgentUnavailable(), before: 0, retryAt: 0 },
    })

    expect(preview(failed)).toEqual({ question, answer: "The assistant is not available" })
  })
})

describe("question in view", () => {
  it("is the first question that starts above the composer", () => {
    expect(inView([-900, 120, 400], 600)).toBe(1)
  })

  it("is the question whose answer fills the view when none starts in it", () => {
    expect(inView([-1800, -900, 700], 600)).toBe(1)
  })

  it("is the first question before the layout places any", () => {
    expect(inView([700, 1500], 600)).toBe(0)
  })
})
