import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"

import { CatalogEntry, SearchText } from "./Catalog.ts"
import { ConversationId, Question, Step, Turn } from "./Conversation.ts"
import {
  AgentUnavailable,
  CatalogUnavailable,
  ConversationBusy,
  IndicatorNotFound,
  SourceUnavailable,
  TooManyQuestions,
  TransformNotApplicable,
} from "./Errors.ts"
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
      error: [IndicatorNotFound, SourceUnavailable, TransformNotApplicable],
    }),
  )
  .prefix("/views") {}

class Catalog extends HttpApiGroup.make("catalog")
  .add(
    HttpApiEndpoint.get("search", "/search", {
      query: { q: SearchText },
      success: Schema.Array(CatalogEntry),
      error: [SourceUnavailable, CatalogUnavailable],
    }),
  )
  .prefix("/catalog") {}

// One conversation with the agent. Its turns are empty until the first
// question; a conversation idle for 30 days is deleted and reads as empty.
// An answer streams its steps. Once the stream has started, a failure arrives
// in it rather than as an HTTP status.
class Conversation extends HttpApiGroup.make("conversation")
  .add(
    HttpApiEndpoint.get("turns", "/:id", {
      params: { id: ConversationId },
      success: Schema.Array(Turn),
      error: AgentUnavailable,
    }),
  )
  .add(
    HttpApiEndpoint.post("ask", "/:id/questions", {
      params: { id: ConversationId },
      payload: Schema.Struct({ question: Question }),
      success: HttpApiSchema.StreamSse({
        data: Step,
        error: Schema.Union([AgentUnavailable, SourceUnavailable, CatalogUnavailable]),
      }),
      error: [AgentUnavailable, TooManyQuestions, ConversationBusy],
    }),
  )
  .prefix("/conversations") {}

export class Api extends HttpApi.make("civicdata")
  .add(System)
  .add(Views)
  .add(Catalog)
  .add(Conversation)
  .prefix("/api") {}

// The part of the API a conversation's Durable Object serves. The Worker
// passes these requests on to it unchanged.
export class ConversationApi extends HttpApi.make("conversation")
  .add(Conversation)
  .prefix("/api") {}
