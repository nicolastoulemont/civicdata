import { Schema } from "effect"

import { Country } from "./Country.ts"
import { DimensionId } from "./Dimension.ts"
import {
  AgentUnavailable,
  CatalogUnavailable,
  IndicatorNotFound,
  SourceUnavailable,
} from "./Errors.ts"
import { IndicatorId } from "./Indicator.ts"
import { Source } from "./Source.ts"
import { View } from "./View.ts"

// Questions are capped so one request cannot send the model an essay.
export const Question = Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(500))

// A conversation with the agent. The browser makes a random UUID, which is
// also what lets someone read the conversation: whoever has the id has it.
export const ConversationId = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("ConversationId"),
)

export type ConversationId = typeof ConversationId.Type

// One step of the agent's work while it answers, such as a search, reported
// when it starts and again when it ends. Its id is the model's tool call id,
// or one the agent gives the steps it takes on its own, so a report replaces
// the one before it with the same id.
export const StepId = Schema.NonEmptyString.pipe(Schema.brand("StepId"))

export type StepId = typeof StepId.Type

// How many of something a step found: zero or more.
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

// A step in progress.
export const Running = Schema.TaggedStruct("Running", {})

// A step that could not end: its source, the catalog or the model did not
// answer, or the indicator it asked about does not exist.
export const Failed = Schema.TaggedStruct("Failed", {
  reason: Schema.Union([
    SourceUnavailable,
    CatalogUnavailable,
    AgentUnavailable,
    IndicatorNotFound,
  ]),
})

// The person stopped the answer: as a step's state, while the step ran, and
// as the answer's ending.
export const Stopped = Schema.TaggedStruct("Stopped", {})

// A step's states: running, then ended in one of `done`, failed or stopped.
const live = <const Done extends ReadonlyArray<Schema.Top>>(...done: Done) =>
  Schema.Union([Running, ...done, Failed, Stopped])

// The states a step can end in.
const ended = <const Done extends ReadonlyArray<Schema.Top>>(...done: Done) =>
  Schema.Union([...done, Failed, Stopped])

// The model decided: a tool started, or it answered.
export const Thought = Schema.TaggedStruct("Done", {})

// The indicators a search found, `count` in all, and the best few, best first.
export const Searched = Schema.TaggedStruct("Done", {
  count: Count,
  top: Schema.Array(Schema.Struct({ indicator: IndicatorId, name: Schema.String })),
})

// The agent searches indicators for `text`, of one source when it names one.
const search = <S extends Schema.Top>(state: S) => ({
  id: StepId,
  text: Schema.String,
  source: Schema.optionalKey(Source),
  state,
})

// The name of the indicator whose definition the agent read.
export const Read = Schema.TaggedStruct("Done", { name: Schema.String })

// The agent reads an indicator's full definition.
const definition = <S extends Schema.Top>(state: S) => ({
  id: StepId,
  indicator: IndicatorId,
  state,
})

// The countries each place name may mean, best first: one when it is plain,
// several when it is ambiguous, none when no source has data for it.
export const Located = Schema.TaggedStruct("Done", {
  places: Schema.Array(Schema.Struct({ name: Schema.String, countries: Schema.Array(Country) })),
})

// The agent looks up place names, e.g. "Ivory Coast".
const lookup = <S extends Schema.Top>(state: S) => ({
  id: StepId,
  names: Schema.Array(Schema.String),
  state,
})

// Why the data cannot show a chart. The step's view says which indicator,
// countries, years and transform it asked for.
// - NoValues: the source has no values for those countries and years.
// - NoIndicator: no source has `indicator`, the chart's or one it divides by
//   or plots against.
// - NotApplicable: the transform does not apply to the indicator, e.g. per
//   person to a percentage.
// - OpenDimensions: the dataflow holds several series, and the chart has not
//   picked one of these dimensions, or picked a value they do not take.
export const Rejection = Schema.TaggedUnion({
  NoValues: {},
  NoIndicator: { indicator: IndicatorId },
  NotApplicable: {},
  OpenDimensions: { open: Schema.NonEmptyArray(DimensionId) },
})

export type Rejection = typeof Rejection.Type

// The values fetched for the chart: how many there were.
export const Fetched = Schema.TaggedStruct("Done", { values: Count })

// The data cannot show the chart; the agent tries again.
export const Rejected = Schema.TaggedStruct("Rejected", { reason: Rejection })

// The agent fetches the data of the chart it proposed, which checks it.
const fetch = <S extends Schema.Top>(state: S) => ({ id: StepId, view: View, state })

// The takeaway kept, with how many of its numbers were checked against the data.
export const Checked = Schema.TaggedStruct("Done", { numbers: Count })

// The takeaway had a number that is not in the data, so the chart shows
// without one.
export const Dropped = Schema.TaggedStruct("Dropped", {})

// The agent writes the chart's takeaway and checks it against the data.
const takeaway = <S extends Schema.Top>(state: S) => ({ id: StepId, state })

// A step of work in any state, as it streams. Thinking is the model deciding
// what to do next.
const Work = Schema.TaggedUnion({
  Thinking: { id: StepId, state: live(Thought) },
  Search: search(live(Searched)),
  Definition: definition(live(Read)),
  Lookup: lookup(live(Located)),
  Fetch: fetch(live(Fetched, Rejected)),
  Takeaway: takeaway(live(Checked, Dropped)),
})

export type Work = typeof Work.Type

export const { Thinking, Search, Definition, Lookup, Fetch, Takeaway } = Work.cases

// A step of work that ended, as a turn keeps it. Thinking is not kept: it
// only fills the time between steps.
export const Ended = Schema.TaggedUnion({
  Search: search(ended(Searched)),
  Definition: definition(ended(Read)),
  Lookup: lookup(ended(Located)),
  Fetch: fetch(ended(Fetched, Rejected)),
  Takeaway: takeaway(ended(Checked, Dropped)),
})

// Steps as turns saved before steps had states keep them: what the agent
// asked for, with the sources a search found once those were recorded.
const Legacy = Schema.Union([
  Schema.TaggedStruct("Searched", {
    text: Schema.String,
    source: Schema.optionalKey(Source),
    found: Schema.optionalKey(Schema.Array(Source)),
  }),
  Schema.TaggedStruct("Described", { indicator: IndicatorId }),
  Schema.TaggedStruct("Located", { names: Schema.Array(Schema.String) }),
  Schema.TaggedStruct("Rejected", { problem: Schema.String }),
])

// The chart that answers the question, with what the agent says it shows.
// An answer has no takeaway when the agent's text failed the check, and
// answers saved before takeaways existed have none.
export const Answered = Schema.TaggedStruct("Answered", {
  view: View,
  takeaway: Schema.optionalKey(Schema.NonEmptyString),
})

// The question can be read several ways that give different charts; the
// agent asks which, offering choices. The reply is the next question.
export const Asked = Schema.TaggedStruct("Asked", {
  question: Schema.String,
  choices: Schema.NonEmptyArray(Schema.String),
})

// No World Bank indicator measures what the question asks.
export const Unanswered = Schema.TaggedStruct("Unanswered", {})

// What the agent did while answering, streamed as it happens: each step of
// work every time its state changes, then how the answer ended.
export const Step = Schema.Union([Work, Answered, Asked, Unanswered, Stopped])

export type Step = typeof Step.Type

const isWork = Schema.is(Work)

// The steps with `step` in place of the one with its id, or after them when
// it is new or ends the answer.
export const put = <S extends Step>(steps: ReadonlyArray<S>, step: S): ReadonlyArray<S> => {
  const index = isWork(step) ? steps.findIndex((each) => isWork(each) && each.id === step.id) : -1

  return index === -1 ? [...steps, step] : steps.with(index, step)
}

// How an answer ended.
export const Ending = Schema.Union([Answered, Asked, Unanswered, Stopped])

export type Ending = typeof Ending.Type

// A question and how the agent answered it: the steps it ended on the way,
// and how long the answer took from the question to its ending. Turns saved
// before the work log have neither.
export const Turn = Schema.Struct({
  question: Question,
  answer: Ending,
  steps: Schema.optionalKey(Schema.Array(Schema.Union([Ended, Legacy]))),
  took: Schema.optionalKey(Schema.DurationFromMillis),
})

export interface Turn extends Schema.Schema.Type<typeof Turn> {}

// The question being answered now, and when the server started answering it.
const Answering = Schema.Struct({ question: Question, started: Schema.DateTimeUtc })

// A conversation as its page shows it: the questions answered so far, oldest
// first, and the question being answered now, if any.
export const Turns = Schema.Struct({
  answered: Schema.Array(Turn),
  answering: Schema.optionalKey(Answering),
})

export interface Turns extends Schema.Schema.Type<typeof Turns> {}
