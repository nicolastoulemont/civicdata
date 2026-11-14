import type { CatalogEntry, Direction, IndicatorId } from "@repo/domain"
import { Data, type Effect } from "effect"

import type { ClassifierUnavailable } from "./Classifier.schemas.ts"

export type Classifying = Data.TaggedEnum<{
  // The deployment classifies nothing: only production does
  // (packages/infra/alchemy.run.ts), and only with an OpenAI key.
  Off: {}
  On: {
    // The model that answers. A stored direction records it, so a build
    // asks again about an entry another model classified.
    readonly model: string
    // Which way each entry's values are better. An entry the model answers
    // with anything but the three directions, refuses, leaves out or
    // answers below its confidence threshold is Neutral.
    readonly classify: (
      entries: ReadonlyArray<CatalogEntry>,
    ) => Effect.Effect<ReadonlyMap<IndicatorId, Direction>, ClassifierUnavailable>
  }
}>

export const Classifying = Data.taggedEnum<Classifying>()
