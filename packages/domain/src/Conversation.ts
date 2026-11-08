import { Schema } from "effect"

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
// with Answered or Unanswered.
export const Searched = Schema.TaggedStruct("Searched", { text: Schema.String })

// The data could not show the chart the agent proposed; it tries again.
export const Rejected = Schema.TaggedStruct("Rejected", { problem: Schema.String })

export const Answered = Schema.TaggedStruct("Answered", { view: View })

// No World Bank indicator measures what the question asks.
export const Unanswered = Schema.TaggedStruct("Unanswered", {})

export const Step = Schema.Union([Searched, Rejected, Answered, Unanswered])

export type Step = typeof Step.Type

// A question and the chart that answered it, or null when none did.
export const Turn = Schema.Struct({ question: Question, view: Schema.NullOr(View) })

export interface Turn extends Schema.Schema.Type<typeof Turn> {}
