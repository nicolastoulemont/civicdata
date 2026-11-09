import { Schema } from "effect"

import { IndicatorId } from "./Indicator.ts"
import { View } from "./View.ts"

// Questions are capped so one request cannot send the model an essay.
export const Question = Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(500))

// A conversation with the agent. The browser makes a random UUID, which is
// also what lets someone read the conversation: whoever has the id has it.
export const ConversationId = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("ConversationId"),
)

export type ConversationId = typeof ConversationId.Type

// What the agent did while answering, streamed as it happens. An answer ends
// with Answered, Asked, Unanswered or Stopped.
export const Searched = Schema.TaggedStruct("Searched", { text: Schema.String })

// The agent read an indicator's full definition.
export const Described = Schema.TaggedStruct("Described", { indicator: IndicatorId })

// The agent looked up place names, e.g. "Ivory Coast".
export const Located = Schema.TaggedStruct("Located", { names: Schema.Array(Schema.String) })

// The data could not show the chart the agent proposed; it tries again.
export const Rejected = Schema.TaggedStruct("Rejected", { problem: Schema.String })

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

// The person stopped the answer before the agent finished it.
export const Stopped = Schema.TaggedStruct("Stopped", {})

export const Step = Schema.Union([
  Searched,
  Described,
  Located,
  Rejected,
  Answered,
  Asked,
  Unanswered,
  Stopped,
])

export type Step = typeof Step.Type

// What the agent did before its answer ended.
export const Work = Schema.Union([Searched, Described, Located, Rejected])

export type Work = typeof Work.Type

// How an answer ended.
export const Ending = Schema.Union([Answered, Asked, Unanswered, Stopped])

export type Ending = typeof Ending.Type

// A question and how the agent answered it: what it did on the way, and how
// long the answer took from the question to its ending. Turns saved before
// the work log have neither.
export const Turn = Schema.Struct({
  question: Question,
  answer: Ending,
  steps: Schema.optionalKey(Schema.Array(Work)),
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
