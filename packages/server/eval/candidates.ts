import {
  ChartIndex,
  chartsOf,
  Down,
  Ended,
  Ending,
  Exhausted,
  Rejected,
  TurnIndex,
  Unanswered,
  Up,
  View,
  Vote,
} from "@civicdata/domain"
import { Array as Arr, Order, Schema } from "effect"

// A row of the answer log, as docs/answers.md describes it.
export const Logged = Schema.Struct({
  asked: Schema.String,
  questions: Schema.fromJsonString(Schema.Array(Schema.String)),
  changed: Schema.fromJsonString(
    Schema.Array(Schema.Struct({ turn: TurnIndex, chart: ChartIndex, view: View })),
  ),
  ending: Schema.fromJsonString(Ending),
  steps: Schema.fromJsonString(Schema.Array(Ended)),
  took: Schema.NullOr(Schema.Number),
  model: Schema.String,
  version: Schema.NullOr(Schema.String),
  trace: Schema.NullOr(Schema.String),
  vote: Schema.NullOr(Schema.fromJsonString(Vote)),
  changes: Schema.Number,
  downloads: Schema.Number,
  shares: Schema.Number,
})

export interface Logged extends Schema.Schema.Type<typeof Logged> {}

// What makes an answer worth a look, and how much: a vote down weighs most,
// an answer that ended without one next, then each chart the server sent
// back and each change the person made to the charts.
interface Sign {
  readonly says: string
  readonly weight: number
}

// A logged answer worth a look, with why.
export interface Candidate {
  readonly row: Logged
  readonly signs: Arr.NonEmptyReadonlyArray<Sign>
}

const isUp = Schema.is(Up)
const isDown = Schema.is(Down)
const isExhausted = Schema.is(Exhausted)
const isUnanswered = Schema.is(Unanswered)
const isRejected = Schema.is(Rejected)

const times = (count: number, one: string, many: string) =>
  count === 1 ? `1 ${one}` : `${count} ${many}`

const signsOf = (row: Logged): ReadonlyArray<Sign> => {
  const rejected = row.steps.filter(
    (step) => Ended.guards.Fetch(step) && isRejected(step.state),
  ).length

  return [
    ...(row.vote !== null && isDown(row.vote)
      ? [
          {
            says: row.vote.reason === undefined ? "voted down" : `voted down: ${row.vote.reason}`,
            weight: 8,
          },
        ]
      : []),
    ...(isExhausted(row.ending) ? [{ says: "cut short", weight: 4 }] : []),
    ...(isUnanswered(row.ending) ? [{ says: "unanswered", weight: 4 }] : []),
    ...(rejected > 0
      ? [{ says: times(rejected, "chart sent back", "charts sent back"), weight: rejected }]
      : []),
    ...(row.changes > 0
      ? [{ says: `charts changed ${times(row.changes, "time", "times")}`, weight: row.changes }]
      : []),
  ]
}

const weightOf = ({ signs }: Candidate) => signs.reduce((sum, { weight }) => sum + weight, 0)

// Worst first; among equals, the latest first.
const worstFirst = Order.combine(
  Order.flip(Order.mapInput(Order.Number, weightOf)),
  Order.flip(Order.mapInput(Order.String, ({ row }: Candidate) => row.asked)),
)

// The answers worth a look, worst first. An answer voted up is not one,
// whatever else happened to it.
export const candidates = (rows: ReadonlyArray<Logged>): ReadonlyArray<Candidate> =>
  Arr.sort(
    rows.flatMap((row) => {
      const signs = signsOf(row)

      return (row.vote !== null && isUp(row.vote)) || !Arr.isReadonlyArrayNonEmpty(signs)
        ? []
        : [{ row, signs }]
    }),
    worstFirst,
  )

const encodeView = Schema.encodeSync(Schema.fromJsonString(View))

// A candidate as the start of a case for eval/cases.ts: why it is one, the
// questions, the chart the person changed before the last question, and
// what the agent charted, for whoever writes what the case accepts.
export const print = ({ row, signs }: Candidate) => {
  const last = row.questions.length - 1
  const shown = row.changed.find(({ turn, chart }) => turn === last - 1 && chart === 0)
  const charted = chartsOf(row.ending).map(({ view }) => `  // charted ${encodeView(view)}`)

  return [
    `// ${row.asked} · ${signs.map(({ says }) => says).join(" · ")}${row.trace === null ? "" : ` · trace ${row.trace}`}`,
    "{",
    `  questions: ${JSON.stringify(row.questions)},`,
    ...(shown === undefined ? [] : [`  // shown ${encodeView(shown.view)}`]),
    ...(charted.length === 0 ? ["  // charted nothing"] : charted),
    "  accepts: [],",
    "},",
  ].join("\n")
}
