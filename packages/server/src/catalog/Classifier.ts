import { Context, Layer } from "effect"

import { Classifying } from "./Classifier.types.ts"

// Classifies catalog entries by which way their values are better. The
// model's classifier is in ModelClassifier.ts.
export class Classifier extends Context.Service<Classifier, Classifying>()(
  "@repo/server/Classifier",
) {
  static readonly off = Layer.succeed(Classifier, Classifier.of(Classifying.Off()))
}
