import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { TestClock } from "effect/testing"

import { keep, type Storage, Transcript } from "../src/Transcript.ts"

// Durable Object storage in memory, recording each alarm set.
const storage = () => {
  const values = new Map<string, string>()
  const alarms: Array<number> = []

  const fake: Storage = {
    get: (key) => Promise.resolve(values.get(key)),
    put: (key, value) => Promise.resolve(void values.set(key, value)),
    setAlarm: (time) => Promise.resolve(void alarms.push(time)),
  }

  return { fake, alarms }
}

const saved = { chat: "[]", turns: [{ question: "Life expectancy in Brazil", view: null }] }

describe("Transcript.durable", () => {
  it.effect("loads nothing before the first save", () =>
    Effect.gen(function* () {
      const transcript = yield* Transcript

      expect(yield* transcript.load).toEqual(Option.none())
    }).pipe(Effect.provide(Transcript.durable(storage().fake))),
  )

  it.effect("loads what it saved and moves the deletion alarm past the last save", () => {
    const { fake, alarms } = storage()

    return Effect.gen(function* () {
      const transcript = yield* Transcript

      yield* TestClock.setTime(1_000)
      yield* transcript.save(saved)

      expect(yield* transcript.load).toEqual(Option.some(saved))
      expect(alarms).toEqual([1_000 + keep])
    }).pipe(Effect.provide(Transcript.durable(fake)))
  })
})
