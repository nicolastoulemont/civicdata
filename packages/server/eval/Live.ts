import { ChartIndex, TurnIndex } from "@repo/domain"
import { Clock, Effect, Layer, Option, Predicate, Schedule, Stream } from "effect"

import { Agent } from "../src/Agent.ts"
import { Answers } from "../src/Answers.ts"
import { Catalog } from "../src/Catalog.ts"
import { CatalogBuild, database, Step } from "../src/CatalogBuild.ts"
import { Classifier } from "../src/Classifier.ts"
import { Conversation } from "../src/Conversation.ts"
import { Directions } from "../src/Directions.ts"
import { Outlines } from "../src/Outlines.ts"
import { Pace } from "../src/Pace.ts"
import { Politics } from "../src/Politics.ts"
import { PoliticsBuild } from "../src/PoliticsBuild.ts"
import { Resolver } from "../src/Resolver.ts"
import { Structures } from "../src/Structures.ts"
import { Transcript } from "../src/Transcript.ts"
import { Vectors } from "../src/Vectors.ts"
import type { Case } from "./cases.ts"
import { Replayed } from "./Recordings.ts"
import { Tally } from "./Tally.ts"

// Builds the catalog from the sources before the questions run. A source
// that fails keeps the others in the catalog. It classifies nothing, so the
// eval spends no tokens on directions: charts read the stored ones.
const Built = Layer.effectDiscard(
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((generation) => CatalogBuild.run({ id: "eval", generation })),
    Effect.catchTag("BuildFailed", (error) => Effect.logWarning("Catalog build failed", error)),
  ),
).pipe(
  Layer.provide(
    Layer.merge(
      CatalogBuild.layer.pipe(
        Layer.provide(Outlines.layer),
        Layer.provide(Structures.layer),
        Layer.provide(Pace.gathering),
        Layer.provide(database),
        Layer.provide(Vectors.live),
        Layer.provide(Classifier.off),
      ),
      Step.immediate,
    ),
  ),
)

// Stores the elections and governments of the live archives before the
// questions run. An archive that fails leaves its records out.
const Recorded = Layer.effectDiscard(
  Clock.currentTimeMillis.pipe(
    Effect.flatMap(PoliticsBuild.run),
    Effect.catchTag("PoliticsBuildFailed", (error) =>
      Effect.logWarning("Political records build failed", error),
    ),
  ),
).pipe(Layer.provide(Layer.merge(PoliticsBuild.live, Step.immediate)))

// The agent as a conversation runs it, against the live model and archives
// and the sources' recorded answers (eval/Recordings.ts).
export const Live = Layer.mergeAll(
  Agent.live().pipe(Layer.provide(Resolver.layer)),
  Built,
  Recorded,
).pipe(
  Layer.provide(Catalog.live),
  Layer.provide(Politics.live),
  Layer.provide(Replayed),
  Layer.provide(Directions.live),
  // Each question meters its own OpenAI tokens.
  Layer.provideMerge(Tally.layer),
)

// Asks the questions in one conversation, as a person would, and returns its
// turns. A `shown` chart replaces the first chart of the answer before the
// last question, as when a person changes it.
export const answer = Effect.fn("eval.answer")(
  function* ({ questions, shown, country }: Pick<Case, "questions" | "shown" | "country">) {
    const conversation = yield* Conversation

    for (const [turn, question] of questions.entries()) {
      if (shown !== undefined && turn === questions.length - 1) {
        yield* conversation.show(TurnIndex.make(turn - 1), {
          chart: ChartIndex.make(0),
          view: shown,
        })
      }

      yield* Stream.runDrain(yield* conversation.ask(question, Option.fromUndefinedOr(country)))
    }

    return (yield* conversation.turns).answered
  },
  Effect.provide(
    Conversation.layer.pipe(Layer.provide(Transcript.memory), Layer.provide(Answers.none)),
  ),
  // A run that asks the OECD what no recording answers can spend the budget
  // in src/Pace.ts, which fails the answer with SourceUnavailable. That
  // measures the pacer, not the agent, so the questions are asked again in a
  // new conversation once the pacer's minute window has moved on.
  Effect.retry({
    while: Predicate.isTagged("SourceUnavailable"),
    schedule: Schedule.spaced("1 minute"),
    times: 3,
  }),
)
