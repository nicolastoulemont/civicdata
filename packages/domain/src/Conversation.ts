import { Match, Schema } from "effect"

import { Cited, RecordId } from "./Cited.ts"
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
import { Overlays } from "./Politics.ts"
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

// The research findings a lookup found, each with its id and name.
export const Researched = Schema.TaggedStruct("Done", {
  findings: Schema.Array(Schema.Struct({ id: RecordId, name: Schema.String })),
})

// The agent looks up the research findings that explain an indicator in some
// countries over some years.
const research = <S extends Schema.Top>(state: S) => ({
  id: StepId,
  indicator: IndicatorId,
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
// - Short: a trend's values cover under half its years, running only from
//   `from` to `to`; another indicator may cover more.
// - TooMany, TooFew: the chart had more countries than `most`, or fewer than
//   `least`, for its type. No longer produced: charts take any number of
//   countries since NTO-167. Conversations stored before it keep these steps
//   in their work logs, so they stay here to decode them.
export const Rejection = Schema.TaggedUnion({
  NoValues: {},
  NoIndicator: { indicator: IndicatorId },
  NotApplicable: {},
  OpenDimensions: { open: Schema.NonEmptyArray(DimensionId) },
  Short: { from: Year, to: Year },
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

// Consecutive years, first to last.
const Run = Schema.Struct({ from: Year, to: Year })

// What the data has for the countries a lookup asked about: each country's
// first and last year with a value, the runs of years every one of them has
// a value in, and the countries with no value at all, left out of the runs.
export const Covered = Schema.TaggedStruct("Done", {
  countries: Schema.Array(Schema.Struct({ country: Country, first: Year, last: Year })),
  shared: Schema.Array(Run),
  missing: Schema.Array(Country),
})

// Why the agent cannot look up an indicator's years, as it could not chart
// them: no source has the indicator, or its dataflow holds several series
// and the lookup has not picked one.
export const Unresolved = Schema.TaggedStruct("Rejected", {
  reason: Schema.Union([Rejection.cases.NoIndicator, Rejection.cases.OpenDimensions]),
})

// The agent looks up which years an indicator has values for in some
// countries, before it picks a chart's years.
const coverage = <S extends Schema.Top>(state: S) => ({
  id: StepId,
  indicator: IndicatorId,
  countries: Schema.NonEmptyArray(Country),
  state,
})

// A link to the record at `index` in a text's citations, as its Markdown
// writes it: "[Mariano Rajoy](cite:0)".
export const citeLink = (index: number) => `cite:${index}`

// The citation indexes a text links to, in order.
const linkedIn = (text: string) =>
  Array.from(text.matchAll(/\]\(cite:(\d+)\)/g), ([, index]) => Number(index))

// Each citation is linked from the text, and each link names a citation.
const linked = Schema.makeFilter(
  ({ text, cites }: { readonly text: string; readonly cites?: ReadonlyArray<Cited> }) => {
    const links = new Set(linkedIn(text))

    return (
      (links.size === (cites?.length ?? 0) &&
        [...links].every((index) => index < (cites?.length ?? 0))) ||
      "each citation must be linked from the text once, as [name](cite:index)"
    )
  },
)

// What the agent wrote, in Markdown, with the records it cites.
// The text links each record by its place in `cites`, as
// "[Mariano Rajoy](cite:0)".
export const Text = Schema.TaggedStruct("Text", {
  text: Schema.NonEmptyString,
  cites: Schema.optionalKey(Schema.NonEmptyArray(Cited)),
}).check(linked)

// A chart of fetched data, with the political context it draws over a trend,
// if any. The chart's card fetches its data and its source.
export const Chart = Schema.TaggedStruct("Chart", {
  view: View,
  overlays: Schema.optionalKey(Overlays),
})

export type Chart = typeof Chart.Type

// A block of an answer, in the order the agent wrote it: its words or a chart.
export const Block = Schema.Union([Text, Chart])

export type Block = typeof Block.Type

// A chart's place among the charts of its answer, the first 0. Turns are
// kept as they ended, so a place keeps naming the same chart.
export const ChartIndex = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("ChartIndex"),
)

export type ChartIndex = typeof ChartIndex.Type

// What the agent says a chart shows, asked for on demand, e.g. after a person
// changed the chart it drew.
export const Explanation = Schema.Struct({ view: View, text: Schema.NonEmptyString })

export interface Explanation extends Schema.Schema.Type<typeof Explanation> {}

// A step of work in any state, as it streams. Thinking is the model deciding
// what to do next. Rendered is a block of the answer, sent as soon as the
// agent writes it or the data shows its chart.
const Work = Schema.TaggedUnion({
  Thinking: { id: StepId, state: live(Thought) },
  Search: search(live(Searched)),
  Definition: definition(live(Read)),
  Lookup: lookup(live(Located)),
  Records: records(live(Recorded)),
  Research: research(live(Researched)),
  Coverage: coverage(live(Covered, Unresolved)),
  Fetch: fetch(live(Fetched, Rejected)),
  Rendered: { id: StepId, block: Block },
})

export type Work = typeof Work.Type

export const {
  Thinking,
  Search,
  Definition,
  Lookup,
  Records,
  Research,
  Coverage,
  Fetch,
  Rendered,
} = Work.cases

// A step of work that ended, as a turn keeps it. Thinking is not kept: it
// only fills the time between steps.
export const Ended = Schema.TaggedUnion({
  Search: search(ended(Searched)),
  Definition: definition(ended(Read)),
  Lookup: lookup(ended(Located)),
  Records: records(ended(Recorded)),
  Research: research(ended(Researched)),
  Coverage: coverage(ended(Covered, Unresolved)),
  Fetch: fetch(ended(Fetched, Rejected)),
})

// The blocks that answer the question, in the order the agent wrote them.
export const Answered = Schema.TaggedStruct("Answered", {
  blocks: Schema.NonEmptyArray(Block),
})

// The question can be read several ways that give different charts; the
// agent asks which, offering choices. The reply is the next question.
export const Asked = Schema.TaggedStruct("Asked", {
  question: Schema.String,
  choices: Schema.NonEmptyArray(Schema.String),
})

// The agent wrote nothing and showed no chart, e.g. because no indicator
// measures what the question asks.
export const Unanswered = Schema.TaggedStruct("Unanswered", {})

// The person stopped the answer, which keeps the blocks the agent wrote
// before the stop, in order. Answers stopped before any block have none.
export const Stopped = Schema.TaggedStruct("Stopped", {
  blocks: Schema.optionalKey(Schema.NonEmptyArray(Block)),
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

// The blocks an answer ended with: every block of an answer, those written
// before a stop, or none.
export const blocksOf = (ending: Ending): ReadonlyArray<Block> =>
  Match.valueTags(ending, {
    Answered: ({ blocks }) => blocks,
    Stopped: ({ blocks }) => blocks ?? [],
    Asked: () => [],
    Unanswered: () => [],
  })

const isChart = Schema.is(Chart)

// The charts an answer ended with, in order: each one's place is its
// ChartIndex.
export const chartsOf = (ending: Ending): ReadonlyArray<Chart> => blocksOf(ending).filter(isChart)

// The chart on screen in place of each of an answer's charts, at the same
// place: one a person changed the agent's chart to, or null where they did
// not change it.
const Shown = Schema.Array(Schema.NullOr(View))

// A question and how the agent answered it: the steps it ended on the way,
// and how long the answer took from the question to its ending. Turns saved
// before the work log have neither. `shown` holds the charts on screen where
// a person changed the ones the agent answered with; a turn never changed,
// or changed back, has none.
export const Turn = Schema.Struct({
  question: Question,
  answer: Ending,
  steps: Schema.optionalKey(Schema.Array(Ended)),
  took: Schema.optionalKey(Schema.DurationFromMillis),
  shown: Schema.optionalKey(Shown),
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
