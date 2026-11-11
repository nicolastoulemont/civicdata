import { assert, layer } from "@effect/vitest"
import { env } from "cloudflare:workers"
import { Array as Arr, Effect } from "effect"
import { FetchHttpClient } from "effect/http"

import { type Case, cases } from "./cases.ts"
import { answer, Live } from "./Live.ts"
import { score } from "./score.ts"
import { Tally } from "./Tally.ts"

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
          const fetch = yield* (yield* Tally).meter(title(each))

          // The agent's OpenAI client sends through FetchHttpClient, which
          // reads this fetch per request.
          const turns = yield* answer(each).pipe(
            Effect.provideService(FetchHttpClient.Fetch, fetch),
          )

          const turn = yield* Effect.fromOption(Arr.last(turns))

          // A failure shows the turn: what the agent searched, fetched and
          // picked. it.effect swallows logs.
          assert.deepEqual(score(each.accepts, turn.answer), [], JSON.stringify(turn))
        }),
      )
    }
  },
)
