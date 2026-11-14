import { Context } from "effect"

import { model } from "./constants/model.ts"
import { rubric } from "./constants/rubric.ts"

// The model and rubric new annotations use. An annotation key names both, so
// changing either gives every paper a new key (store.ts).
export const Settings = Context.Reference<{ readonly model: string; readonly rubric: string }>(
  "@repo/server/research/Settings",
  { defaultValue: () => ({ model, rubric }) },
)
