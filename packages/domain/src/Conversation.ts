import { Match, Schema, SchemaGetter } from "effect"

import { Country } from "./Country.ts"
import { DimensionId } from "./Dimension.ts"
import {
  AgentUnavailable,
  CatalogUnavailable,
  IndicatorNotFound,
  PoliticsUnavailable,
  SourceUnavailable,
} from "./Errors.ts"
import { IndicatorId } from "./Indicator.ts"
import { Cited, nameOf, Overlays } from "./Politics.ts"
import { Source } from "./Source.ts"
import { View, Year } from "./View.ts"

// Questions are capped so one request cannot send the model an essay.
export const maxQuestion = 500

export const Question = Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(maxQuestion))

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

// A step that could not end: its source, the catalog, the political records
// or the model did not answer, or the indicator it asked about does not exist.
export const Failed = Schema.TaggedStruct("Failed", {
  reason: Schema.Union([
    SourceUnavailable,
    CatalogUnavailable,
    PoliticsUnavailable,
    AgentUnavailable,
    IndicatorNotFound,
  ]),
})

// The person stopped the answer while the step ran.
export const Halted = Schema.TaggedStruct("Stopped", {})

// A step's states: running, then ended in one of `done`, failed or stopped.
const live = <const Done extends ReadonlyArray<Schema.Top>>(...done: Done) =>
  Schema.Union([Running, ...done, Failed, Halted])

// The states a step can end in.
const ended = <const Done extends ReadonlyArray<Schema.Top>>(...done: Done) =>
  Schema.Union([...done, Failed, Halted])

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

// How many political records a lookup found of each kind.
export const Recorded = Schema.TaggedStruct("Done", {
  governments: Count,
  elections: Count,
  events: Count,
  reforms: Count,
})

// The agent looks up the elections, governments, events and reforms of some
// countries over some years.
const records = <S extends Schema.Top>(state: S) => ({
  id: StepId,
  countries: Schema.NonEmptyArray(Country),
  from: Year,
  to: Year,
  state,
})

// Why the agent cannot show a chart. The step's view says which chart type,
// indicator, countries, years and transform it asked for.
// - NoValues: the source has no values for those countries and years.
// - NoIndicator: no source has `indicator`, the chart's or one it divides by
//   or plots against.
// - NotApplicable: the transform does not apply to the indicator, e.g. per
//   person to a percentage.
// - OpenDimensions: the dataflow holds several series, and the chart has not
//   picked one of these dimensions, or picked a value they do not take.
// - TooMany: the chart type shows at most `most` countries and stays readable.
// - TooFew: the chart type needs at least `least` countries to show anything.
export const Rejection = Schema.TaggedUnion({
  NoValues: {},
  NoIndicator: { indicator: IndicatorId },
  NotApplicable: {},
  OpenDimensions: { open: Schema.NonEmptyArray(DimensionId) },
  TooMany: { most: Count },
  TooFew: { least: Count },
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

// Why a takeaway failed the check: it wrote a number that is not in the
// data, named a head of government, party or event from the political
// records without citing it, cited a record the agent did not look up, said
// what caused a movement in the data, or was empty.
export const Unchecked = Schema.Literals(["number", "name", "record", "cause", "empty"])

// The takeaway failed the check, so the chart shows without one. Takeaways
// dropped before the check had several reasons were dropped for a number.
export const Dropped = Schema.TaggedStruct("Dropped", {
  reason: Schema.optionalKey(Unchecked),
})

// The agent writes the chart's takeaway and checks it against the data.
const takeaway = <S extends Schema.Top>(state: S) => ({ id: StepId, state })

// A political record a takeaway cites, and where its name starts in the
// takeaway's text.
export const Cite = Schema.Struct({ at: Count, record: Cited })

// A takeaway and the records it cites, in the order it cites them.
const said = {
  takeaway: Schema.optionalKey(Schema.NonEmptyString),
  cites: Schema.optionalKey(Schema.NonEmptyArray(Cite)),
}

// Each cited record's name stands at its place in the takeaway.
const placed = Schema.makeFilter(
  ({
    takeaway: text,
    cites,
  }: {
    readonly takeaway?: string
    readonly cites?: ReadonlyArray<typeof Cite.Type>
  }) =>
    cites === undefined ||
    (text !== undefined && cites.every(({ at, record }) => text.startsWith(nameOf(record), at))) ||
    "each cited record's name must stand at its place in the takeaway",
)

// A chart of an answer, with what the agent says it shows, the records it
// cites, and the political context it draws over a trend, if any. A chart
// has no takeaway when the agent's text failed the check, and charts saved
// before takeaways existed have none.
export const Chart = Schema.Struct({
  view: View,
  overlays: Schema.optionalKey(Overlays),
  ...said,
}).check(placed)

export interface Chart extends Schema.Schema.Type<typeof Chart> {}

// The most charts one answer holds. Most answers hold one; the agent draws
// more only when one chart cannot show what the question asks.
export const maxCharts = 3

// A chart's place in its answer, the first 0.
export const ChartIndex = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: maxCharts - 1 }),
).pipe(Schema.brand("ChartIndex"))

export type ChartIndex = typeof ChartIndex.Type

// The takeaway the agent kept for a chart it drew, if it kept one, with the
// records it cites.
export const Explained = Schema.TaggedStruct("Done", said).check(placed)

// A step of work in any state, as it streams. Thinking is the model deciding
// what to do next. Drawn is a chart of the answer, sent as soon as the agent
// draws it, with the context it draws over a trend: running while its
// takeaway is written, then done with the takeaway it kept, if any. A stop
// while the takeaway is written keeps the chart without one.
const Work = Schema.TaggedUnion({
  Thinking: { id: StepId, state: live(Thought) },
  Search: search(live(Searched)),
  Definition: definition(live(Read)),
  Lookup: lookup(live(Located)),
  Records: records(live(Recorded)),
  Fetch: fetch(live(Fetched, Rejected)),
  Takeaway: takeaway(live(Checked, Dropped)),
  Drawn: {
    id: StepId,
    view: View,
    overlays: Schema.optionalKey(Overlays),
    state: Schema.Union([Running, Explained, Halted]),
  },
})

export type Work = typeof Work.Type

export const { Thinking, Search, Definition, Lookup, Records, Fetch, Takeaway, Drawn } = Work.cases

// A step of work that ended, as a turn keeps it. Thinking is not kept: it
// only fills the time between steps.
export const Ended = Schema.TaggedUnion({
  Search: search(ended(Searched)),
  Definition: definition(ended(Read)),
  Lookup: lookup(ended(Located)),
  Records: records(ended(Recorded)),
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

// The charts that answer the question, in the order the agent drew them.
export const Answered = Schema.TaggedStruct("Answered", {
  charts: Schema.NonEmptyArray(Chart).check(Schema.isMaxLength(maxCharts)),
})

// The question can be read several ways that give different charts; the
// agent asks which, offering choices. The reply is the next question.
export const Asked = Schema.TaggedStruct("Asked", {
  question: Schema.String,
  choices: Schema.NonEmptyArray(Schema.String),
})

// No World Bank indicator measures what the question asks.
export const Unanswered = Schema.TaggedStruct("Unanswered", {})

// The person stopped the answer, which keeps the charts the agent drew
// before the stop, in order. Answers stopped before any chart, or before
// charts were kept, have none.
export const Stopped = Schema.TaggedStruct("Stopped", {
  charts: Schema.optionalKey(Schema.NonEmptyArray(Chart).check(Schema.isMaxLength(maxCharts))),
})

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

// The charts an answer ended with: every chart of an answer, those drawn
// before a stop, or none.
export const chartsOf = (ending: Ending): ReadonlyArray<Chart> =>
  Match.valueTags(ending, {
    Answered: ({ charts }) => charts,
    Stopped: ({ charts }) => charts ?? [],
    Asked: () => [],
    Unanswered: () => [],
  })

// An answer saved when answers held one chart reads as an answer of one.
const OneChart = Schema.TaggedStruct("Answered", {
  view: Schema.toEncoded(View),
  takeaway: Schema.optionalKey(Schema.String),
}).pipe(
  Schema.decodeTo(Answered, {
    decode: SchemaGetter.transform(({ _tag, ...chart }) => ({ _tag, charts: [chart] })),
    encode: SchemaGetter.forbidden(() => "Answers are saved with their charts"),
  }),
)

// The chart on screen in place of each of an answer's charts, at the same
// place: one a person changed the agent's chart to, or null where they did
// not change it.
const Shown = Schema.Array(Schema.NullOr(View))

// A turn saved when answers held one chart kept the chart its first chart
// was changed to.
const ShownOne = Schema.toEncoded(View).pipe(
  Schema.decodeTo(Shown, {
    decode: SchemaGetter.transform((view) => [view]),
    encode: SchemaGetter.forbidden(() => "Changed charts are saved per chart"),
  }),
)

// A question and how the agent answered it: the steps it ended on the way,
// and how long the answer took from the question to its ending. Turns saved
// before the work log have neither. `shown` holds the charts on screen where
// a person changed the ones the agent answered with; a turn never changed,
// or changed back, has none.
export const Turn = Schema.Struct({
  question: Question,
  answer: Schema.Union([Ending, OneChart]),
  steps: Schema.optionalKey(Schema.Array(Schema.Union([Ended, Legacy]))),
  took: Schema.optionalKey(Schema.DurationFromMillis),
  shown: Schema.optionalKey(Schema.Union([Shown, ShownOne])),
})

export interface Turn extends Schema.Schema.Type<typeof Turn> {}

// A turn's place in its conversation, the first one 0. Turns are only ever
// added, so a place keeps naming the same turn.
export const TurnIndex = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("TurnIndex"),
)

export type TurnIndex = typeof TurnIndex.Type

// The question being answered now, and when the server started answering it.
const Answering = Schema.Struct({ question: Question, started: Schema.DateTimeUtc })

// A conversation as its page shows it: the questions answered so far, oldest
// first, and the question being answered now, if any.
export const Turns = Schema.Struct({
  answered: Schema.Array(Turn),
  answering: Schema.optionalKey(Answering),
})

export interface Turns extends Schema.Schema.Type<typeof Turns> {}
