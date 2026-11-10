import type { CatalogEntry, Direction, IndicatorId } from "@civicdata/domain"
import { Context, Effect, Layer, Schema } from "effect"

// The model could not classify a batch: it is down, refused the request, or
// the deployment has no model.
export class ClassifierUnavailable extends Schema.TaggedError<
  ClassifierUnavailable,
  { readonly brand: unique symbol }
>()("ClassifierUnavailable", { cause: Schema.Defect() }) {}

interface Interface {
  // Which way each entry's values are better. An entry the model answers
  // with anything but the three directions, or leaves out, is Neutral.
  readonly classify: (
    entries: ReadonlyArray<CatalogEntry>,
  ) => Effect.Effect<ReadonlyMap<IndicatorId, Direction>, ClassifierUnavailable>
}

// Classifies catalog entries by which way their values are better. The
// language model's classifier is in ModelClassifier.ts, apart from this
// module, so the catalog build and its tests load without effect/ai.
export class Classifier extends Context.Service<Classifier, Interface>()(
  "@civicdata/server/Classifier",
) {
  static readonly unavailable = Layer.succeed(
    Classifier,
    Classifier.of({
      classify: () =>
        Effect.fail(new ClassifierUnavailable({ cause: "The deployment has no OpenAI key" })),
    }),
  )
}
