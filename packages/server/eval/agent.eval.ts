import { TurnIndex } from "@civicdata/domain"
import { assert, layer } from "@effect/vitest"
import { env } from "cloudflare:workers"
import { Array as Arr, Clock, Effect, Layer, Predicate, Schedule, Stream } from "effect"

import { Agent } from "../src/Agent.ts"
import { Catalog } from "../src/Catalog.ts"
import { CatalogBuild, Step } from "../src/CatalogBuild.ts"
import { Conversation } from "../src/Conversation.ts"
import { Resolver } from "../src/Resolver.ts"
import { Sdmx } from "../src/Sdmx.ts"
import { Transcript } from "../src/Transcript.ts"
import { WorldBank } from "../src/WorldBank.ts"
import { type Case, cases } from "./cases.ts"
import { score } from "./score.ts"

// Builds the catalog from the live sources before the questions run. A
// source that fails keeps the others in the catalog.
const Built = Layer.effectDiscard(
  Clock.currentTimeMillis.pipe(
    Effect.flatMap(CatalogBuild.run),
    Effect.catchTag("BuildFailed", (error) => Effect.logWarning("Catalog build failed", error)),
  ),
).pipe(Layer.provide(Layer.merge(CatalogBuild.live, Step.immediate)))

// The agent as a conversation runs it, against the live sources and model.
const Live = Layer.merge(Agent.live.pipe(Layer.provide(Resolver.layer)), Built).pipe(
  Layer.provide(Catalog.live),
  Layer.provide(WorldBank.live),
  Layer.provide(Sdmx.live),
)

// Asks the questions in one conversation, as a person would, and returns the
// last turn. A case's `shown` chart replaces the answer before the last
// question, as when a person changes it.
const answer = Effect.fn("eval.answer")(
  function* ({ questions, shown }: Case) {
    const conversation = yield* Conversation

    for (const [turn, question] of questions.entries()) {
      if (shown !== undefined && turn === questions.length - 1) {
        yield* conversation.show(TurnIndex.make(turn - 1), shown)
      }

      yield* Stream.runDrain(yield* conversation.ask(question))
    }

    return yield* Effect.fromOption(Arr.last((yield* conversation.turns).answered))
  },
  Effect.provide(Conversation.layer.pipe(Layer.provide(Transcript.memory))),
  // The eval asks the OECD faster than the pacer in src/Pace.ts allows, and a
  // spent budget fails the answer with SourceUnavailable. That measures the
  // pacer, not the agent, so the case is asked again in a new conversation
  // once the pacer's minute window has moved on.
  Effect.retry({
    while: Predicate.isTagged("SourceUnavailable"),
    schedule: Schedule.spaced("1 minute"),
    times: 3,
  }),
)

const title = ({ questions, shown }: Case) =>
  (shown === undefined
    ? questions
    : [...questions.slice(0, -1), "(the person changes the chart)", ...questions.slice(-1)]
  ).join(" → ")

layer(Live, { concurrent: true, excludeTestServices: true, timeout: "2 minutes" })(
  env.OPENAI_MODEL ?? "the default model",
  (it) => {
    for (const each of cases) {
      it.effect(title(each), () =>
        Effect.gen(function* () {
          const turn = yield* answer(each)

          // A failure shows the turn: what the agent searched, fetched and
          // picked. it.effect swallows logs.
          assert.deepEqual(score(each.accepts, turn.answer), [], JSON.stringify(turn))
        }),
      )
    }
  },
)
