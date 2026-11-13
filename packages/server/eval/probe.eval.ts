import { layer } from "@effect/vitest"
import type { Turn } from "@repo/domain"
import { env } from "cloudflare:workers"
import { Cause, DateTime, Duration, Effect, Exit, Schema } from "effect"
import { FetchHttpClient } from "effect/http"

import { defaultModel } from "../src/assistant/model.ts"
import { answer, Live } from "./Live.ts"
import { Probed, ProbedJson, probes } from "./probes.ts"
import { Tally } from "./Tally.ts"

type Probed = typeof Probed.Type

const model = env.OPENAI_MODEL ?? defaultModel

// The folder this run writes to, through the RUNS binding that
// vitest.eval.config.ts serves from Node.
const runs = Effect.sync(() => {
  const binding = env.RUNS

  if (binding === undefined) throw new Error("The probe run needs the RUNS binding")

  return binding
})

// Writes a probe's file into this run's folder.
const write = Effect.fnUntraced(function* (probed: Probed) {
  const binding = yield* runs
  const json = yield* Schema.encodeEffect(ProbedJson)(probed)

  // A file not written fails the probe, as a defect.
  yield* Effect.promise(async () => {
    const response = await binding.fetch(
      new Request(`https://runs/${probed.probe.id}.json`, { method: "PUT", body: json }),
    )

    if (!response.ok) throw new Error(`${probed.probe.id} not written: ${response.status}`)
  })
})

// Asks every probe and writes how the agent answered, one file per probe,
// for a reviewer to judge (eval/probes.md). Nothing is scored here: a probe
// fails only when its answer failed, and its file says why.
layer(Live, { concurrent: true, excludeTestServices: true, timeout: "4 minutes" })(model, (it) => {
  for (const probe of probes) {
    it.effect(`${probe.id}: ${probe.questions.join(" → ")}`, () =>
      Effect.gen(function* () {
        const fetch = yield* (yield* Tally).meter(probe.id)
        const asked = DateTime.formatIso(yield* DateTime.now)

        // The agent's OpenAI client sends through FetchHttpClient, which
        // reads this fetch per request.
        const exit = yield* answer(probe).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
          Effect.exit,
        )

        const rowsOf = (turns: ReadonlyArray<Turn>) =>
          turns.map((turn, index) => ({
            asked,
            questions: probe.questions.slice(0, index + 1),
            changed: [],
            ending: turn.answer,
            steps: turn.steps ?? [],
            took: turn.took === undefined ? null : Duration.toMillis(turn.took),
            model,
            version: null,
            trace: null,
            vote: null,
            changes: 0,
            downloads: 0,
            shares: 0,
          }))

        yield* write(
          Exit.isSuccess(exit)
            ? { probe, rows: rowsOf(exit.value), failure: null }
            : { probe, rows: [], failure: Cause.pretty(exit.cause) },
        )

        yield* exit
      }),
    )
  }
})
