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
// with Answered, Asked or Unanswered.
export const Searched = Schema.TaggedStruct("Searched", { text: Schema.String })

// The agent read an indicator's full definition.
export const Described = Schema.TaggedStruct("Described", { indicator: IndicatorId })

// The agent looked up place names, e.g. "Ivory Coast".
export const Located = Schema.TaggedStruct("Located", { names: Schema.Array(Schema.String) })

// The data could not show the chart the agent proposed; it tries again.
export const Rejected = Schema.TaggedStruct("Rejected", { problem: Schema.String })

export const Answered = Schema.TaggedStruct("Answered", { view: View })

// The question can be read several ways that give different charts; the
// agent asks which, offering choices. The reply is the next question.
export const Asked = Schema.TaggedStruct("Asked", {
  question: Schema.String,
  choices: Schema.NonEmptyArray(Schema.String),
})

// No World Bank indicator measures what the question asks.
export const Unanswered = Schema.TaggedStruct("Unanswered", {})

export const Step = Schema.Union([
  Searched,
  Described,
  Located,
  Rejected,
  Answered,
  Asked,
  Unanswered,
])

export type Step = typeof Step.Type

// How an answer ended.
export const Ending = Schema.Union([Answered, Asked, Unanswered])

export type Ending = typeof Ending.Type

// A question and how the agent answered it.
export const Turn = Schema.Struct({ question: Question, answer: Ending })

export interface Turn extends Schema.Schema.Type<typeof Turn> {}
