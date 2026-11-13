import { describe, expect, it } from "@effect/vitest"
import { IndicatorId, SourceUnavailable } from "@repo/domain"
import { Effect, Fiber, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"

import { Sdmx } from "../../sources/sdmx/Sdmx.ts"
import { http, memory } from "../../tests/fakes.ts"
import population from "../../tests/fixtures/eurostat/population-flow.json"
import oecdFlow from "../../tests/fixtures/oecd/unemployment-flow.json"
import { empty, type Ledger, Pace, refuse, Slot, take } from "../Pace.ts"
import { PaceObject } from "../PaceObject.ts"

const minute = 60_000

// Takes `count` slots for the OECD at `now`, with no patience.
const takeMany = (count: number, { ledger, now }: { ledger: Ledger; now: number }) =>
  Array.from({ length: count }).reduce<{ ledger: Ledger; slots: Array<Slot> }>(
    (state) => {
      const next = take("OECD", { ledger: state.ledger, now, patience: 0 })

      return { ledger: next.ledger, slots: [...state.slots, next.slot] }
    },
    { ledger, slots: [] },
  )

describe("take", () => {
  it("lets 15 OECD requests go in a minute, then makes the next wait for the oldest to age out", () => {
    const { ledger, slots } = takeMany(16, { ledger: empty, now: 0 })

    expect(slots.filter(Slot.guards.Granted)).toHaveLength(15)
    expect(slots.at(-1)).toEqual(Slot.cases.Full.make({ wait: minute }))
    expect(take("OECD", { ledger, now: 0, patience: minute }).slot).toEqual(
      Slot.cases.Granted.make({ wait: minute }),
    )
  })

  it("keeps the OECD to 50 requests an hour", () => {
    // 15 a minute for four minutes: 60 asked, 50 let go.
    const asked = [0, 1, 2, 3].reduce(
      (state, step) => {
        const next = takeMany(15, { ledger: state.ledger, now: step * minute })

        return {
          ledger: next.ledger,
          granted: state.granted + next.slots.filter(Slot.guards.Granted).length,
        }
      },
      { ledger: empty, granted: 0 },
    )

    expect(asked.granted).toBe(50)
    expect(
      Slot.guards.Full(take("OECD", { ledger: asked.ledger, now: 30 * minute, patience: 0 }).slot),
    ).toBe(true)
    expect(
      Slot.guards.Granted(
        take("OECD", { ledger: asked.ledger, now: 61 * minute, patience: 0 }).slot,
      ),
    ).toBe(true)
  })

  it("asks nothing of a source for its cooldown after it refuses", () => {
    const refused = refuse("OECD", { ledger: empty, now: 0 })

    expect(
      Slot.guards.Full(take("OECD", { ledger: refused, now: 4 * minute, patience: 0 }).slot),
    ).toBe(true)
    expect(
      Slot.guards.Granted(take("OECD", { ledger: refused, now: 5 * minute, patience: 0 }).slot),
    ).toBe(true)
  })
})

const oecd = "https://sdmx.oecd.org/public/rest"
const eurostat = "https://ec.europa.eu/eurostat/api/dissemination"
const lfs = IndicatorId.make("OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0")
const tps00001 = IndicatorId.make("ESTAT,TPS00001,1.0")

// The SDMX adapter behind the paced client. The OECD refuses its first
// request with a 429; Eurostat answers.
const paced = () => {
  const asked: Array<string> = []
  let refusals = 1

  const layer = Sdmx.layer.pipe(
    Layer.provide(Pace.client),
    Layer.provide(
      http((url) => {
        asked.push(url)

        if (url.startsWith(eurostat)) return Response.json(population)

        if (refusals > 0) {
          refusals -= 1

          return new Response("You have exceeded the number of requests", { status: 429 })
        }

        return Response.json(oecdFlow)
      }),
    ),
    Layer.provide(Pace.memory),
  )

  return { layer, asked }
}

describe("Pace.client", () => {
  it.effect("asks the OECD nothing for five minutes after a 429, and still asks Eurostat", () => {
    const source = paced()

    return Effect.gen(function* () {
      const sdmx = yield* Sdmx

      expect(yield* sdmx.OECD.describe(lfs).pipe(Effect.flip)).toEqual(
        new SourceUnavailable({ source: "OECD" }),
      )

      yield* TestClock.adjust("4 minutes")

      expect(yield* sdmx.OECD.describe(lfs).pipe(Effect.flip)).toEqual(
        new SourceUnavailable({ source: "OECD" }),
      )
      expect(source.asked.filter((url) => url.startsWith(oecd))).toHaveLength(1)

      yield* sdmx.Eurostat.describe(tps00001)

      yield* TestClock.adjust("1 minute")

      const described = yield* sdmx.OECD.describe(lfs)

      expect(described.indicator.name).toBe("Monthly unemployment rates")
      expect(source.asked.filter((url) => url.startsWith(oecd))).toHaveLength(2)
    }).pipe(Effect.provide(source.layer))
  })

  it.effect("holds a request until a slot frees up within two seconds", () => {
    const asked: Array<number> = []

    const layer = Sdmx.layer.pipe(
      Layer.provide(Pace.client),
      Layer.provide(
        http(() => {
          asked.push(asked.length)

          return Response.json(oecdFlow)
        }),
      ),
      Layer.provide(
        Layer.succeed(
          Pace,
          Pace.of({
            take: () => Effect.succeed(Slot.cases.Granted.make({ wait: 1500 })),
            refused: () => Effect.void,
          }),
        ),
      ),
    )

    return Effect.gen(function* () {
      const fiber = yield* (yield* Sdmx).OECD.describe(lfs).pipe(Effect.forkScoped)

      yield* TestClock.adjust("1 second")

      expect(asked).toHaveLength(0)

      yield* TestClock.adjust("1 second")

      const described = yield* Fiber.join(fiber)

      expect(described.indicator.name).toBe("Monthly unemployment rates")
      expect(asked).toHaveLength(1)
    }).pipe(Effect.provide(layer))
  })
})

// A Durable Object's storage, in memory.
const state = () => {
  const stored = new Map<string, string>()

  return {
    storage: {
      get: (key: string) => Promise.resolve(stored.get(key)),
      put: (key: string, value: string) => {
        stored.set(key, value)

        return Promise.resolve()
      },
    },
  }
}

const SlotJson = Schema.fromJsonString(Slot)

const post = (pace: PaceObject, path: string) =>
  pace.fetch(new Request(`https://pace${path}`, { method: "POST" }))

// The waits a host's limiter grants two requests in a row, which the clock
// separates by a few milliseconds at most. One object per host, as the PACE
// namespace names them.
const waits = async (host: string) => {
  const pace = new PaceObject(state())

  const wait = async () =>
    Schema.decodeSync(SlotJson)(
      await (await post(pace, `/take?source=${host}&patience=5000`)).text(),
    ).wait

  return [await wait(), await wait()]
}

describe("PaceObject", () => {
  it("grants slots until the source's budget is spent, and keeps count in storage", async () => {
    const storage = state()
    const first = new PaceObject(storage)

    for (let request = 0; request < 15; request += 1)
      // oxlint-disable-next-line no-await-in-loop
      await post(first, "/take?source=OECD&patience=0")

    // A new instance, as after an eviction, reads the same ledger.
    const answer = await post(new PaceObject(storage), "/take?source=OECD&patience=0")

    expect(Slot.guards.Full(Schema.decodeSync(SlotJson)(await answer.text()))).toBe(true)
  })

  it("refuses every request after the source refused one", async () => {
    const pace = new PaceObject(state())

    expect((await post(pace, "/refused?source=OECD")).status).toBe(204)

    const answer = await post(pace, "/take?source=OECD&patience=0")

    expect(Slot.guards.Full(Schema.decodeSync(SlotJson)(await answer.text()))).toBe(true)
  })

  it("paces a newly registered publisher conservatively", async () => {
    const pace = new PaceObject(state())
    expect((await post(pace, "/take?source=Fixture&patience=0")).status).toBe(200)
    const answer = await post(pace, "/take?source=Fixture&patience=0")
    expect(Slot.guards.Full(Schema.decodeSync(SlotJson)(await answer.text()))).toBe(true)
  })

  it("paces a paper host: OpenAlex once a second, any other host every two seconds", async () => {
    const openalex = await waits("api.openalex.org")
    const publisher = await waits("www.econstor.eu")

    expect(openalex[0]).toBe(0)
    expect(openalex[1]).toBeGreaterThan(990)
    expect(publisher[1]).toBeGreaterThan(1990)
  })

  it("rejects a malformed source name", async () => {
    expect((await post(new PaceObject(state()), "/take?source=invalid/name")).status).toBe(400)
  })
})

describe("Sdmx stale results", () => {
  it.effect("serves a stored dataflow past its freshness while its source is unavailable", () => {
    let down = false

    const layer = Sdmx.cached.pipe(
      Layer.provide(
        http(() => (down ? new Response("down", { status: 503 }) : Response.json(population))),
      ),
      Layer.provide(memory().layer),
    )

    return Effect.gen(function* () {
      const sdmx = yield* Sdmx
      const first = yield* sdmx.Eurostat.describe(tps00001)

      down = true

      yield* TestClock.adjust("2 days")

      // Eurostat is asked three times, a second and two seconds apart.
      const fiber = yield* sdmx.Eurostat.describe(tps00001).pipe(Effect.forkScoped)

      yield* TestClock.adjust("3 seconds")

      expect(yield* Fiber.join(fiber)).toEqual(first)
    }).pipe(Effect.provide(layer))
  })
})
