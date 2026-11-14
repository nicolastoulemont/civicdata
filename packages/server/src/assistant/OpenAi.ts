import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import { Layer, Redacted } from "effect"

import { defaultModel } from "./constants/defaultModel.ts"

interface Options {
  // The model the deployment names in OPENAI_MODEL.
  readonly model?: string | undefined
  // The key OpenAI keeps the prompt cache under: requests sharing a key and
  // a prompt's start are sent where that start is already cached, and pay a
  // tenth for it.
  readonly cache?: string | undefined
}

// The named model at that model's default effort, or else the default model
// at high effort. The agent and the titles script both use it. A module of
// its own, since @effect/ai-openai is large: the catalog build and its tests
// load without it.
export const languageModel = ({ model, cache }: Options = {}) => {
  const keyed = cache === undefined ? {} : { prompt_cache_key: cache }

  return model === undefined
    ? OpenAiLanguageModel.model(defaultModel, { reasoning: { effort: "high" }, ...keyed })
    : OpenAiLanguageModel.model(model, keyed)
}

// The language model over OpenAI's API, needing an HttpClient.
export const openAi = (apiKey: string, options: Options = {}) =>
  languageModel(options).pipe(Layer.provide(OpenAiClient.layer({ apiKey: Redacted.make(apiKey) })))
