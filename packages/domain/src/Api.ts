import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"

import { CatalogEntry, SearchText } from "./Catalog.ts"
import { Answered, ConversationId, Question, Step, TurnIndex, Turns } from "./Conversation.ts"
import {
  AgentUnavailable,
  CatalogUnavailable,
  ConversationBusy,
  DimensionsMissing,
  IndicatorNotFound,
  NoChart,
  PoliticsUnavailable,
  SourceUnavailable,
  TooManyQuestions,
  TransformNotApplicable,
  TurnNotFound,
} from "./Errors.ts"
import { IndicatorId, IndicatorNotes } from "./Indicator.ts"
import { Politics as PoliticalRecords, PoliticsQuery } from "./Politics.ts"
import { ResolvedView } from "./ResolvedView.ts"
import { View } from "./View.ts"

class System extends HttpApiGroup.make("system", { topLevel: true }).add(
  HttpApiEndpoint.get("health", "/health", { success: HttpApiSchema.NoContent }),
) {}

class Views extends HttpApiGroup.make("views")
  .add(
    HttpApiEndpoint.post("resolve", "/resolve", {
      payload: View,
      success: ResolvedView,
      error: [IndicatorNotFound, SourceUnavailable, TransformNotApplicable, DimensionsMissing],
    }),
  )
  // The agent's takeaway for a chart, e.g. one edited since the agent showed
  // it. Each request costs a model call, so it counts against the same limit
  // as questions.
  .add(
    HttpApiEndpoint.post("explain", "/explain", {
      payload: View,
      success: Answered,
      error: [
        AgentUnavailable,
        TooManyQuestions,
        IndicatorNotFound,
        SourceUnavailable,
        TransformNotApplicable,
        DimensionsMissing,
      ],
    }),
  )
  .prefix("/views") {}

class Indicators extends HttpApiGroup.make("indicators")
  .add(
    HttpApiEndpoint.get("notes", "/:indicator/notes", {
      params: { indicator: IndicatorId },
      success: IndicatorNotes,
      error: [IndicatorNotFound, SourceUnavailable],
    }),
  )
  .prefix("/indicators") {}

class Catalog extends HttpApiGroup.make("catalog")
  .add(
    HttpApiEndpoint.get("search", "/search", {
      query: { q: SearchText },
      success: Schema.Array(CatalogEntry),
      error: [SourceUnavailable, CatalogUnavailable],
    }),
  )
  .prefix("/catalog") {}

// The governments of some countries over some years, for a trend chart to
// draw beside its lines.
class Politics extends HttpApiGroup.make("politics")
  .add(
    HttpApiEndpoint.get("records", "/", {
      query: PoliticsQuery,
      success: PoliticalRecords,
      error: PoliticsUnavailable,
    }),
  )
  .prefix("/politics") {}

// An answer's steps as they happen. Once the stream has started, a failure
// arrives in it rather than as an HTTP status.
const Steps = HttpApiSchema.StreamSse({
  data: Step,
  error: Schema.Union([AgentUnavailable, SourceUnavailable, CatalogUnavailable]),
})

// One conversation with the agent. Its turns are empty until the first
// question; a conversation idle for 30 days is deleted and reads as empty.
// An answer runs to the end and is kept even when nobody reads it: `answer`
// streams the one in progress from its first step, and nothing when there is
// none. Only `stop` ends an answer early: it keeps the turn as Stopped, and
// does nothing once the answer has ended. `show` keeps the chart a person
// changed a turn's chart to, and the next question builds on it; showing the
// agent's own chart changes the turn back. It works while an answer runs.
class Conversation extends HttpApiGroup.make("conversation")
  .add(
    HttpApiEndpoint.get("turns", "/:id", {
      params: { id: ConversationId },
      success: Turns,
      error: AgentUnavailable,
    }),
  )
  .add(
    HttpApiEndpoint.post("ask", "/:id/questions", {
      params: { id: ConversationId },
      payload: Schema.Struct({ question: Question }),
      success: Steps,
      error: [AgentUnavailable, TooManyQuestions, ConversationBusy],
    }),
  )
  .add(
    HttpApiEndpoint.get("answer", "/:id/answer", {
      params: { id: ConversationId },
      success: Steps,
      error: AgentUnavailable,
    }),
  )
  .add(
    HttpApiEndpoint.delete("stop", "/:id/answer", {
      params: { id: ConversationId },
      success: HttpApiSchema.NoContent,
      error: AgentUnavailable,
    }),
  )
  .add(
    HttpApiEndpoint.put("show", "/:id/turns/:turn/chart", {
      params: { id: ConversationId, turn: TurnIndex },
      payload: View,
      success: HttpApiSchema.NoContent,
      error: [AgentUnavailable, TurnNotFound, NoChart],
    }),
  )
  .prefix("/conversations") {}

export class Api extends HttpApi.make("civicdata")
  .add(System)
  .add(Views)
  .add(Indicators)
  .add(Catalog)
  .add(Politics)
  .add(Conversation)
  .prefix("/api") {}

// The part of the API a conversation's Durable Object serves. The Worker
// passes these requests on to it unchanged.
export class ConversationApi extends HttpApi.make("conversation")
  .add(Conversation)
  .prefix("/api") {}
