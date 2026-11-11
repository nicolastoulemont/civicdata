import {
  Answered,
  Cited,
  Asked,
  Chart,
  Dimensions,
  Exhausted,
  IndicatorId,
  Politics,
  Ranking,
  Relation,
  Text,
  Trend,
  Unanswered,
  type View,
  Year,
} from "@openfacts/domain"
import { Array as Arr, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { Expected, score } from "../eval/score.ts"
import events from "../src/official/events.json"

const lifeExpectancy = IndicatorId.make("SP.DYN.LE00.IN")

// Life expectancy in Brazil and Mexico, 2005 to 2025: right for the case below
// unless a test changes it.
const brazilAndMexico = (changes: Partial<Trend> = {}) =>
  Trend.make({
    indicator: lifeExpectancy,
    countries: ["BRA", "MEX"],
    from: Year.make(2005),
    to: Year.make(2025),
    ...changes,
  })

// An answer of these charts, in order.
const charted = (...views: Arr.NonEmptyReadonlyArray<View>) =>
  Answered.make({ blocks: Arr.map(views, (view) => Chart.make({ view })) })

const trend = (changes: Partial<Trend> = {}) => charted(brazilAndMexico(changes))

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

  it("scores the political context a chart draws when the case names it", () => {
    const governed = Answered.make({
      blocks: [Chart.make({ view: brazilAndMexico(), overlays: ["governments"] })],
    })

    expect(score([{ ...expected, overlays: ["governments"] }], governed)).toEqual([])
    expect(score([{ ...expected, overlays: [] }], governed)).toEqual([
      "overlays governments, want none",
    ])
    expect(score([{ ...expected, overlays: ["events"] }], trend())).toEqual([
      "overlays none, want events",
    ])
    // A case that names no context does not score it.
    expect(score([expected], governed)).toEqual([])
  })

  it("scores the records an answer's words cite when the case names them", () => {
    const [crisis] = Schema.decodeUnknownSync(Politics.fields.events)(
      events.filter(({ id }) => id === "financial-crisis"),
    )

    if (crisis === undefined) throw new Error("events.json has no financial crisis")

    const event = Cited.cases.Event.make({ event: crisis })

    const text =
      "Life expectancy rose after the [Global financial crisis and Great Recession](cite:0)."

    const cited = Answered.make({
      blocks: [Chart.make({ view: brazilAndMexico() }), Text.make({ text, cites: [event] })],
    })

    expect(score([{ ...expected, cites: ["event:financial-crisis"] }], cited)).toEqual([])
    expect(score([{ ...expected, cites: [] }], cited)).toEqual([
      "cites event:financial-crisis, want none",
    ])
    expect(score([{ ...expected, cites: ["event:financial-crisis"] }], trend())).toEqual([
      "cites none, want event:financial-crisis",
    ])
  })

  it("rejects a ranking where a trend is expected", () => {
    const ranking = charted(
      Ranking.make({ indicator: lifeExpectancy, countries: ["BRA"], year: Year.make(2020) }),
    )

    expect(score([expected], ranking)).toEqual(["a ranking, want a trend"])
  })

  it("tells a map from a ranking of the same countries", () => {
    const ranking = Ranking.make({
      indicator: lifeExpectancy,
      countries: ["BRA", "MEX"],
      year: Year.make(2020),
    })

    const map = Expected.Map({ ...expected, year: 2020 })

    expect(score([map], charted(Ranking.make({ ...ranking, as: "Map" })))).toEqual([])
    expect(score([map], charted(ranking))).toEqual(["a ranking, want a map"])
  })

  it("tells a map over time from a map of one year", () => {
    const map = Ranking.make({
      indicator: lifeExpectancy,
      countries: ["BRA", "MEX"],
      year: Year.make(2020),
      as: "Map",
    })

    const moving = Ranking.make({ ...map, span: { from: Year.make(2000), to: Year.make(2020) } })

    expect(score([Expected.Map({ ...expected, overTime: true })], charted(moving))).toEqual([])
    expect(score([Expected.Map({ ...expected, overTime: true })], charted(map))).toEqual([
      "one year, want over time",
    ])
    expect(score([Expected.Map(expected)], charted(moving))).toEqual(["over time, want one year"])
  })

  it("tells a relation over time from a relation of one year", () => {
    const relation = Relation.make({
      indicator: lifeExpectancy,
      against: IndicatorId.make("NY.GDP.PCAP.CD"),
      countries: ["BRA", "MEX"],
      year: Year.make(2020),
    })

    const wanted = Expected.Relation({ ...expected, against: ["NY.GDP.PCAP.CD"], overTime: true })

    const moving = Relation.make({
      ...relation,
      span: { from: Year.make(2000), to: Year.make(2020) },
    })

    expect(score([wanted], charted(moving))).toEqual([])
    expect(score([wanted], charted(relation))).toEqual(["one year, want over time"])
  })

  it("scores the indicator a relation plots against", () => {
    const relation = charted(
      Relation.make({
        indicator: lifeExpectancy,
        against: IndicatorId.make("NY.GDP.PCAP.CD"),
        countries: ["BRA", "MEX"],
        year: Year.make(2020),
      }),
    )

    expect(
      score([Expected.Relation({ ...expected, against: ["NY.GDP.PCAP.CD"] })], relation),
    ).toEqual([])
    expect(
      score([Expected.Relation({ ...expected, against: ["NY.GDP.PCAP.KD"] })], relation),
    ).toEqual(["against NY.GDP.PCAP.CD, want NY.GDP.PCAP.KD"])
  })

  describe("several charts", () => {
    const mexico = brazilAndMexico({ countries: ["MEX"] })
    const both = Expected.Charts({ charts: [expected, { ...expected, countries: ["MEX"] }] })

    it("accepts the charts a case lists, in its order", () => {
      expect(score([both], charted(brazilAndMexico(), mexico))).toEqual([])
      expect(score([both], charted(mexico, brazilAndMexico()))).toEqual([
        "chart 1: countries MEX, want MEX, BRA",
        "chart 2: countries BRA, MEX, want MEX",
      ])
    })

    it("counts a chart missing, and one too many", () => {
      expect(score([both], charted(brazilAndMexico()))).toEqual(["1 chart, want 2"])
      expect(score([expected], charted(brazilAndMexico(), mexico))).toEqual(["2 charts, want 1"])
    })
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

  it("fails an answer cut short at the limit or ended with a question, charts and all", () => {
    const charts = [Chart.make({ view: brazilAndMexico() })] as const

    expect(score([expected], Exhausted.make({ blocks: charts }))).toEqual([
      "cut short, want a trend",
    ])
    expect(score([Expected.Unanswered()], Exhausted.make({}))).toEqual(["cut short, want no chart"])
    expect(
      score([expected], Asked.make({ question: "Which GDP?", choices: ["Real"], blocks: charts })),
    ).toEqual(['the question "Which GDP?", want a trend'])
  })

  it("scores the charts of an answer and none of its text", () => {
    const said = Text.make({ text: "No indicator measures this." })

    expect(score([Expected.Unanswered()], Answered.make({ blocks: [said] }))).toEqual([])
    expect(score([expected], Answered.make({ blocks: [said] }))).toEqual(["no chart, want a trend"])
    expect(
      score([expected], Answered.make({ blocks: [said, Chart.make({ view: brazilAndMexico() })] })),
    ).toEqual([])
  })

  describe("series", () => {
    const unemployment = IndicatorId.make("ESTAT,UNE_RT_A,1.0")

    const sdmx = (dimensions: Record<string, string>) =>
      trend({ indicator: unemployment, dimensions: Schema.decodeSync(Dimensions)(dimensions) })

    const wants = Expected.Trend({
      ...expected,
      indicators: ["SL.UEM.TOTL.ZS"],
      series: [
        {
          indicator: unemployment,
          dimensions: { age: ["Y15-74", "Y15-64"], sex: ["T"], unit: ["PC_ACT"] },
        },
      ],
    })

    it("accepts the series the case names, whatever else the chart picks", () => {
      expect(score([wants], sdmx({ age: "Y15-74", sex: "T", unit: "PC_ACT", extra: "X" }))).toEqual(
        [],
      )
    })

    it("accepts any of the values a dimension lists", () => {
      expect(score([wants], sdmx({ age: "Y15-64", sex: "T", unit: "PC_ACT" }))).toEqual([])
    })

    it("names each dimension whose pick differs or is missing", () => {
      expect(score([wants], sdmx({ age: "Y15-24", sex: "T" }))).toEqual([
        "age Y15-24, want Y15-74 or Y15-64",
        "unit none, want PC_ACT",
      ])
    })

    it("scores no series of an indicator listed without them", () => {
      const plain = Expected.Trend({ ...expected, indicators: [unemployment] })

      expect(score([plain], sdmx({ age: "Y15-24" }))).toEqual([])
    })

    it("scores no series of an indicator the case does not accept", () => {
      const other = Expected.Trend({
        ...expected,
        indicators: [],
        series: [{ indicator: "ESTAT,TIPSUN20,1.0", dimensions: { age: ["Y15-74"] } }],
      })

      expect(score([other], sdmx({ age: "Y15-24" }))).toEqual([
        `indicator ${unemployment}, want ESTAT,TIPSUN20,1.0`,
      ])
    })
  })
})
