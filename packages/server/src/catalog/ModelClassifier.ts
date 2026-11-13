import { type CatalogEntry, Direction, IndicatorId } from "@repo/domain"
import { Effect, Layer, Option, type Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

import { Classifier, ClassifierUnavailable, Classifying } from "./Classifier.ts"

// The only model OpenAI's Decisions API serves.
const model = "gpt-6-luna"

const url = "https://api.openai.com/v1/decisions"

// An answer below this confidence is stored as Neutral.
const threshold = 0.8

const rubric = `You classify statistical indicators from the World Bank, Eurostat and the OECD by which way their values are better for a country's people.

Each question is one indicator: its code, its official name and its definition. Choose one direction:

- Higher: almost everyone agrees more is better, e.g. life expectancy, literacy, GDP per person, access to clean water, a governance score where higher means better governance.
- Lower: almost everyone agrees less is better, e.g. unemployment, infant mortality, poverty, homicides, public debt, air pollution exposure.
- Neutral: anything else.

Choose Neutral when:
- reasonable people disagree, e.g. government spending, tax revenue, migration, fertility, population, inflation, wages as a share of income, or any sector's share of GDP, trade or employment;
- the indicator is a total or a count that grows with a country's size, e.g. GDP, exports, population, number of doctors or students;
- it splits a total into parts, e.g. shares by field of study, sector, age group or type, where no part is better than another;
- it is measured before a policy acts, e.g. poverty before social transfers;
- the name or definition does not make the direction clear;
- the dataset holds series that differ in direction, e.g. employment and unemployment rates in one dataset, or a value and its share above and below a threshold. Eurostat and OECD codes name whole datasets, so read their names for this: choose Higher or Lower for one only when every series its name suggests is better the same way.

When in doubt, choose Neutral. A wrong direction is worse than none.`

const choices = [
  { value: "Higher", description: "More is better, and almost everyone agrees." },
  { value: "Lower", description: "Less is better, and almost everyone agrees." },
  { value: "Neutral", description: "Contested, unclear, a size or a split, or in doubt." },
] satisfies ReadonlyArray<{ value: Direction; description: string }>

// One choice question per entry, named by its code, holding its name and
// its definition cut to 400 characters.
const question = ({ indicator, name, definition }: CatalogEntry) => ({
  type: "choice",
  name: indicator,
  instructions: JSON.stringify({ indicator, name, definition: definition.slice(0, 400) }),
  choices,
})

// A Decisions response, keeping each answer undecoded: one bad answer only
// makes its own entry Neutral.
const Response = Schema.Struct({ answers: Schema.Array(Schema.Unknown) })

// The one answer that gives a direction. A refusal, a choice outside the
// three or any other answer does not decode, and is Neutral.
const Chosen = Schema.Struct({
  type: Schema.Literal("choice"),
  name: IndicatorId,
  choice: Direction,
  confidence: Schema.Finite,
})

const decodeChosen = Schema.decodeUnknownOption(Chosen)

// Asks OpenAI's Decisions API, one request per batch of up to 400 entries.
export const modelClassifier = (apiKey: Redacted.Redacted) =>
  Layer.effect(
    Classifier,
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

      const classify = Effect.fn("Classifier.classify")(
        function* (entries: ReadonlyArray<CatalogEntry>) {
          const { answers } = yield* client
            .execute(
              HttpClientRequest.post(url).pipe(
                HttpClientRequest.bearerToken(apiKey),
                HttpClientRequest.bodyJsonUnsafe({
                  model,
                  input: [{ role: "developer", content: rubric }],
                  questions: entries.map(question),
                }),
              ),
            )
            .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Response)))

          const confident = new Map(
            answers
              .flatMap((answer) => Option.toArray(decodeChosen(answer)))
              .filter(({ confidence }) => confidence >= threshold)
              .map(({ name, choice }) => [name, choice] as const),
          )

          return new Map(
            entries.map(({ indicator }) => [indicator, confident.get(indicator) ?? "Neutral"]),
          )
        },
        Effect.mapError((cause) => new ClassifierUnavailable({ cause })),
      )

      return Classifier.of(Classifying.On({ model, classify }))
    }),
  )
