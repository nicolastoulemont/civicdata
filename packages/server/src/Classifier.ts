import type { CatalogEntry, Direction, IndicatorId } from "@openfacts/domain"
import { Context, Data, type Effect, Layer, Schema } from "effect"

// The model could not classify a batch: it is down, refused the request, or
// answered something that is not a Decisions response.
export class ClassifierUnavailable extends Schema.TaggedError<
  ClassifierUnavailable,
  { readonly brand: unique symbol }
>()("ClassifierUnavailable", { cause: Schema.Defect() }) {}

type Classifying = Data.TaggedEnum<{
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

// Classifies catalog entries by which way their values are better. The
// model's classifier is in ModelClassifier.ts.
export class Classifier extends Context.Service<Classifier, Classifying>()(
  "@openfacts/server/Classifier",
) {
  static readonly off = Layer.succeed(Classifier, Classifier.of(Classifying.Off()))
}
