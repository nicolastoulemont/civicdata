import { Schema } from "effect"

// UI locales accepted at storage and HTTP boundaries.
export const Locale = Schema.Literals([
  "en-US",
  "fr-FR",
  "es-ES",
  "pt-BR",
  "pt-PT",
  "it-IT",
  "de-DE",
  "zh-CN",
])

export type Locale = typeof Locale.Type
