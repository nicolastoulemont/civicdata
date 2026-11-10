import { type CatalogEntry, Direction, type IndicatorId } from "@civicdata/domain"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { LanguageModel } from "effect/ai"

import { about } from "./model.ts"

// The model could not classify a batch: it is down, refused the request, or
// the deployment has no model.
class ClassifierUnavailable extends Schema.TaggedError<
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

const instructions = `You classify statistical indicators from the World Bank, Eurostat and the OECD by which way their values are better for a country's people.

For each indicator you get its code, its official name and its definition. Answer one direction per code:

- Higher: almost everyone agrees more is better, e.g. life expectancy, literacy, GDP per person, access to clean water, a governance score where higher means better governance.
- Lower: almost everyone agrees less is better, e.g. unemployment, infant mortality, poverty, homicides, public debt, air pollution exposure.
- Neutral: anything else.

Answer Neutral when:
- reasonable people disagree, e.g. government spending, tax revenue, migration, fertility, population, inflation, wages as a share of income, or any sector's share of GDP, trade or employment;
- the indicator is a total or a count that grows with a country's size, e.g. GDP, exports, population, number of doctors or students;
- it splits a total into parts, e.g. shares by field of study, sector, age group or type, where no part is better than another;
- it is measured before a policy acts, e.g. poverty before social transfers;
- the name or definition does not make the direction clear;
- the dataset holds series that differ in direction, e.g. employment and unemployment rates in one dataset, or a value and its share above and below a threshold. Eurostat and OECD codes name whole datasets, so read their names for this: answer Higher or Lower for one only when every series its name suggests is better the same way.

When in doubt, answer Neutral. A wrong direction is worse than none.`

// What the model answers. The direction is any string, so one bad answer
// leaves only its entry Neutral instead of failing the batch.
const Answer = Schema.Struct({
  directions: Schema.Array(
    Schema.Struct({
      indicator: Schema.String,
      direction: Schema.String.annotate({ description: "Higher, Lower or Neutral" }),
    }),
  ),
})

const decodeDirection = Schema.decodeUnknownOption(Direction)

export class Classifier extends Context.Service<Classifier, Interface>()(
  "@civicdata/server/Classifier",
) {
  // Needs a LanguageModel.
  static readonly layer = Layer.effect(
    Classifier,
    Effect.gen(function* () {
      const model = yield* LanguageModel.LanguageModel

      const classify = Effect.fn("Classifier.classify")(
        function* (entries: ReadonlyArray<CatalogEntry>) {
          const { value } = yield* model.generateObject({
            objectName: "directions",
            schema: Answer,
            prompt: about(instructions, entries),
          })

          const answered = new Map(
            value.directions.map(({ indicator, direction }) => [indicator, direction]),
          )

          return new Map(
            entries.map(({ indicator }) => [
              indicator,
              Option.getOrElse(decodeDirection(answered.get(indicator)), () => "Neutral" as const),
            ]),
          )
        },
        Effect.mapError((cause) => new ClassifierUnavailable({ cause })),
      )

      return Classifier.of({ classify })
    }),
  )

  static readonly unavailable = Layer.succeed(
    Classifier,
    Classifier.of({
      classify: () =>
        Effect.fail(new ClassifierUnavailable({ cause: "The deployment has no OpenAI key" })),
    }),
  )
}
