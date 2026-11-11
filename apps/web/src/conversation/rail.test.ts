import {
  AgentUnavailable,
  Answered,
  Chart,
  Exhausted,
  Asked,
  IndicatorId,
  Stopped,
  Trend,
  type Turn,
  TurnIndex,
  Unanswered,
  Year,
} from "@openfacts/domain"
import { describe, expect, it } from "vitest"

import { createI18n } from "../locale.tsx"
import { inView, preview as describeEntry } from "./rail.ts"
import { Entry } from "./timeline.ts"

const preview = (entry: Entry) =>
  describeEntry(entry, createI18n().getFixedT("en-US", "conversation"))

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
    expect(preview(turn(Exhausted.make({})))).toEqual({ question, answer: "Cut short" })
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

describe("questions in view", () => {
  it("are the questions that start above the composer", () => {
    expect(inView([-900, 120, 400, 700], 600)).toEqual({ first: 1, last: 2 })
  })

  it("are the question whose answer fills the view when none starts in it", () => {
    expect(inView([-1800, -900, 700], 600)).toEqual({ first: 1, last: 1 })
  })

  it("are the first question before the layout places any", () => {
    expect(inView([700, 1500], 600)).toEqual({ first: 0, last: 0 })
  })
})
