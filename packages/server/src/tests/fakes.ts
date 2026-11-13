import { Deferred, Effect, Exit, Layer, Option, Tracer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

import type { Storage } from "../assistant/Transcript.ts"
import { Cache } from "../platform/Cache.ts"
import { Step, StepFailed } from "../platform/Step.ts"
import * as Traces from "../platform/Traces.ts"

// An HttpClient that answers every request with `respond`, never the network.
export const http = (respond: (url: string) => Response) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, respond(request.url))),
    ),
  )

// A tracer that keeps every span it starts, for a test to read what a trace
// records, settled as the deployed tracer is (Traces.settled). Nothing is
// exported.
export const recording = () => {
  const spans: Array<Tracer.Span> = []

  const tracer = Tracer.make({
    span: (options) => {
      const span = Tracer.nativeTracer.span(options)

      spans.push(span)

      return span
    },
  })

  return {
    spans,
    layer: Layer.succeed(Tracer.Tracer, Traces.settled(tracer)),
  }
}

// For tests that need no source: everything is missing.
export const offline = http(() => new Response("not recorded", { status: 404 }))

// A cache in memory whose entries the test can read and change.
export const memory = () => {
  const store = new Map<string, string>()

  const layer = Layer.succeed(
    Cache,
    Cache.of({
      get: (key) => Effect.sync(() => Option.fromNullishOr(store.get(key))),
      put: (key, value) =>
        Effect.sync(() => {
          store.set(key, value)
        }),
    }),
  )

  return { store, layer }
}

// Durable Object storage in memory, recording each alarm set. A transaction
// keeps its writes only when its closure resolves. With `alarmFails`, setting
// an alarm rejects, as when storage fails. `deleted` completes once
// everything has been deleted.
export const memoryStorage = (
  values = new Map<string, string>(),
  { alarmFails = false }: { alarmFails?: boolean } = {},
) => {
  const alarms: Array<number> = []
  const deleted = Deferred.makeUnsafe<void>()

  const fake: Storage = {
    get: (key) => Promise.resolve(values.get(key)),
    put: (key, value) => Promise.resolve(void values.set(key, value)),
    getAlarm: () => Promise.resolve(alarms.at(-1) ?? null),
    transaction: async (closure) => {
      const puts = new Map<string, string>()
      const set: Array<number> = []

      await closure({
        put: (key, value) => Promise.resolve(void puts.set(key, value)),
        setAlarm: (time) =>
          alarmFails
            ? Promise.reject(new Error("The alarm could not be set"))
            : Promise.resolve(void set.push(time)),
      })

      for (const [key, value] of puts) values.set(key, value)
      alarms.push(...set)
    },
    deleteAll: () => {
      values.clear()
      Deferred.doneUnsafe(deleted, Exit.void)

      return Promise.resolve()
    },
  }

  return { fake, alarms, deleted }
}

// Runs each step at once, as Workflows does when a step succeeds, after
// `before` (a test's look at the catalog mid-build), and saves its result. A
// step that completed in an earlier run answers its saved result without
// running, as when Workflows resumes a build. A failing step fails for good:
// the test stands for a step whose retries all failed. The first run of the
// step named `lose` runs, then fails without saving, as when the Worker stops
// before Workflows saves the result. A sleep runs `before`, then ends at once.
export const steps = (
  before: (name: string) => Effect.Effect<void, unknown> = () => Effect.void,
  { lose }: { lose?: string } = {},
) => {
  const ran: Array<string> = []
  const saved = new Map<string, unknown>()
  let lost = false

  const layer = Layer.succeed(
    Step,
    Step.of({
      run: <A, E>(name: string, effect: Effect.Effect<A, E>) =>
        Effect.suspend(() => {
          if (saved.has(name)) {
            // SAFETY: a step's name fixes what it answers, so a saved result
            // has the type of the step that saved it, as in Workflows.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY
            return Effect.succeed(saved.get(name) as A)
          }

          return before(name).pipe(
            Effect.andThen(Effect.sync(() => ran.push(name))),
            Effect.andThen(effect),
            Effect.flatMap((result) => {
              if (name === lose && !lost) {
                lost = true

                return Effect.fail(`The Worker stopped before saving ${name}`)
              }

              saved.set(name, result)

              return Effect.succeed(result)
            }),
            Effect.mapError((cause) => new StepFailed({ step: name, cause })),
          )
        }),
      sleep: (name) =>
        before(name).pipe(
          Effect.andThen(Effect.sync(() => ran.push(name))),
          Effect.andThen(Effect.yieldNow),
          Effect.mapError((cause) => new StepFailed({ step: name, cause })),
        ),
    }),
  )

  return { layer, ran: () => ran }
}
