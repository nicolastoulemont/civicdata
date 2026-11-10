import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import { Layer, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"

import { defaultModel } from "./model.ts"

// The deployment's OpenAI model, or the default. A module of its own, since
// @effect/ai-openai is large: only the agent and the catalog Workflow's
// entry import it, so the catalog build and its tests load without it.
export const openAi = (apiKey: string, model: string | undefined) =>
  OpenAiLanguageModel.model(model ?? defaultModel).pipe(
    Layer.provide(OpenAiClient.layer({ apiKey: Redacted.make(apiKey) })),
    Layer.provide(FetchHttpClient.layer),
  )
