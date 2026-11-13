import { describe, expect, it } from "@effect/vitest"
import { Unanswered } from "@repo/domain"
import { Effect, Exit, Option } from "effect"
import { TestClock } from "effect/testing"

import { memoryStorage } from "../../tests/fakes.ts"
import { keep, Transcript } from "../Transcript.ts"

const saved = {
  chat: "[]",
  turns: [{ question: "Life expectancy in Brazil", answer: Unanswered.make({}) }],
}

describe("Transcript.durable", () => {
  it.effect("loads nothing before the first save", () =>
    Effect.gen(function* () {
      const transcript = yield* Transcript

      expect(yield* transcript.load).toEqual(Option.none())
    }).pipe(Effect.provide(Transcript.durable(memoryStorage().fake))),
  )

  it.effect("loads what it saved and moves the deletion alarm past the last save", () => {
    const { fake, alarms } = memoryStorage()

    return Effect.gen(function* () {
      const transcript = yield* Transcript

      yield* TestClock.setTime(1_000)
      yield* transcript.save(saved)

      expect(yield* transcript.load).toEqual(Option.some(saved))
      expect(alarms).toEqual([1_000 + keep])
    }).pipe(Effect.provide(Transcript.durable(fake)))
  })

  it.effect("keeps nothing when the alarm that would delete it cannot be set", () =>
    Effect.gen(function* () {
      const transcript = yield* Transcript

      expect(Exit.isFailure(yield* Effect.exit(transcript.save(saved)))).toBe(true)
      expect(yield* transcript.load).toEqual(Option.none())
    }).pipe(
      Effect.provide(Transcript.durable(memoryStorage(undefined, { alarmFails: true }).fake)),
    ),
  )
})
