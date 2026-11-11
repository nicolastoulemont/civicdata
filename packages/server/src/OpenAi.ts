import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import { Layer, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"

import { defaultModel } from "./model.ts"

// The model the deployment names in OPENAI_MODEL, at that model's default
// effort, or else the default model at high effort. The agent and the titles script
// both use it. A module of its own, since @effect/ai-openai is large: the
// catalog build and its tests load without it.
export const languageModel = (model: string | undefined) =>
  model === undefined
    ? OpenAiLanguageModel.model(defaultModel, { reasoning: { effort: "high" } })
    : OpenAiLanguageModel.model(model)

export const openAi = (apiKey: string, model: string | undefined) =>
  languageModel(model).pipe(
    Layer.provide(OpenAiClient.layer({ apiKey: Redacted.make(apiKey) })),
    Layer.provide(FetchHttpClient.layer),
  )
