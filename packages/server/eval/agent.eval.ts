import { Ending } from "@civicdata/domain"
import { expect, layer } from "@effect/vitest"
import { env } from "cloudflare:workers"
import { Array as Arr, Effect, Layer, Option, Schema, Stream } from "effect"

import { Agent } from "../src/Agent.ts"
import { Catalog } from "../src/Catalog.ts"
import { Resolver } from "../src/Resolver.ts"
import { Sdmx } from "../src/Sdmx.ts"
import { WorldBank } from "../src/WorldBank.ts"
import { cases } from "./cases.ts"
import { score } from "./score.ts"

// The first search loads the World Bank catalog into D1. Loading it before the
// questions run side by side keeps them from each loading it at once.
const Loaded = Layer.effectDiscard(
  Effect.gen(function* () {
    const catalog = yield* Catalog

    yield* catalog.search("population")
  }),
)

// The agent as a conversation runs it, against the live sources and model.
const Live = Layer.merge(Agent.live.pipe(Layer.provide(Resolver.layer)), Loaded).pipe(
  Layer.provide(Catalog.live),
  Layer.provide(WorldBank.live),
  Layer.provide(Sdmx.live),
)

const isEnding = Schema.is(Ending)

// Asks the questions in one chat and returns how the last answer ended.
const answer = Effect.fn("eval.answer")(function* (questions: ReadonlyArray<string>) {
  const agent = yield* Agent
  const chat = yield* agent.start
  let ending = Option.none<Ending>()

  for (const question of questions) {
    const steps = yield* Stream.runCollect(agent.ask(chat, question))

    ending = Option.filter(Arr.last(steps), isEnding)
  }

  return yield* Effect.fromOption(ending)
})

layer(Live, { concurrent: true, excludeTestServices: true, timeout: "2 minutes" })(
  env.OPENAI_MODEL ?? "the default model",
  (it) => {
    for (const { questions, accepts } of cases) {
      it.effect(questions.join(" → "), () =>
        Effect.gen(function* () {
          expect(score(accepts, yield* answer(questions))).toEqual([])
        }),
      )
    }
  },
)
