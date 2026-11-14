import { describe, expect, it } from "@effect/vitest"
import {
  Answered,
  Chart,
  ChartIndex,
  Down,
  Ended,
  Exhausted,
  Fetched,
  IndicatorId,
  Rejected,
  Rejection,
  StepId,
  Text,
  Trend,
  TurnIndex,
  Unanswered,
  Up,
  Year,
} from "@repo/domain"

import { candidates, type Logged, print } from "../../eval/candidates.ts"

const brazil = Trend.make({
  indicator: IndicatorId.make("SP.DYN.LE00.IN"),
  countries: ["BRA"],
  from: Year.make(2000),
  to: Year.make(2002),
})

const fetched = Ended.cases.Fetch.make({
  id: StepId.make("call-1"),
  view: brazil,
  state: Fetched.make({ values: 3 }),
})

const rejected = Ended.cases.Fetch.make({
  id: StepId.make("call-2"),
  view: brazil,
  state: Rejected.make({ reason: Rejection.cases.NoValues.make({}) }),
})

// A logged answer nobody had reason to look at: charted, not voted on, not
// changed. Each test changes what it is about.
const logged = (delta: Partial<Logged> = {}): Logged => ({
  asked: "2026-11-10T12:00:00.000Z",
  questions: ["Life expectancy in Brazil"],
  changed: [],
  ending: Answered.make({
    blocks: [Chart.make({ view: brazil }), Text.make({ text: "It rose." })],
  }),
  steps: [fetched],
  took: 1000,
  model: "gpt-test",
  version: "abc123",
  trace: "4bf92f3577b34da6a3ce929d0e0e4736",
  vote: null,
  changes: 0,
  downloads: 0,
  shares: 0,
  ...delta,
})

const listed = (rows: ReadonlyArray<Logged>) =>
  candidates(rows).map(({ row, signs }) => [row.questions[0], signs.map(({ says }) => says)])

describe("candidates", () => {
  it("lists answers voted down, cut short, unanswered, sent back or changed, worst first", () => {
    expect(
      listed([
        logged({ questions: ["changed"], changes: 2 }),
        logged({ questions: ["fine"] }),
        logged({ questions: ["voted down"], vote: Down.make({ reason: "countries" }) }),
        logged({ questions: ["unanswered"], ending: Unanswered.make({}), steps: [] }),
        logged({
          questions: ["cut short"],
          ending: Exhausted.make({}),
          asked: "2026-11-11T00:00:00.000Z",
        }),
        logged({ questions: ["sent back"], steps: [rejected, rejected, fetched] }),
      ]),
    ).toEqual([
      ["voted down", ["voted down: countries"]],
      ["cut short", ["cut short"]],
      ["unanswered", ["unanswered"]],
      ["changed", ["charts changed 2 times"]],
      ["sent back", ["2 charts sent back"]],
    ])
  })

  it("leaves out an answer voted up, whatever else happened to it", () => {
    expect(candidates([logged({ vote: Up.make({}), changes: 3, steps: [rejected] })])).toEqual([])
  })

  it("prints a candidate as the start of a case", () => {
    const mexico = Trend.make({ ...brazil, countries: ["MEX"] })

    const [candidate] = candidates([
      logged({
        questions: ["Life expectancy in Brazil", "Why did it fall?"],
        changed: [{ turn: TurnIndex.make(0), chart: ChartIndex.make(0), view: mexico }],
        vote: Down.make({}),
      }),
    ])

    expect(candidate === undefined ? "" : print(candidate)).toBe(
      [
        "// 2026-11-10T12:00:00.000Z · voted down · trace 4bf92f3577b34da6a3ce929d0e0e4736",
        "{",
        '  questions: ["Life expectancy in Brazil","Why did it fall?"],',
        '  // shown {"_tag":"Trend","indicator":"SP.DYN.LE00.IN","countries":["MEX"],"from":2000,"to":2002}',
        '  // charted {"_tag":"Trend","indicator":"SP.DYN.LE00.IN","countries":["BRA"],"from":2000,"to":2002}',
        "  accepts: [],",
        "},",
      ].join("\n"),
    )
  })
})
