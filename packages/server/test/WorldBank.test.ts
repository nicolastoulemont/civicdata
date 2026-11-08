import { IndicatorId, IndicatorNotFound, SourceUnavailable, Year } from "@civicdata/domain"
import { describe, expect, it } from "@effect/vitest"
import { DateTime, Effect, Fiber, Layer, Option } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"

import { Cache } from "../src/Cache.ts"
import { WorldBank } from "../src/WorldBank.ts"
import gaps from "./fixtures/worldbank/gaps.json"
import unknownIndicator from "./fixtures/worldbank/indicator-unknown.json"
import population from "./fixtures/worldbank/indicator.json"

const base = "https://api.worldbank.org/v2"

// Recorded World Bank responses, served by URL.
const recorded = [
  [`${base}/indicator/SP.POP.TOTL?format=json`, population],
  [`${base}/indicator/NOT.A.REAL?format=json`, unknownIndicator],
  [`${base}/country/FRA;SSD/indicator/NY.GDP.PCAP.CD?format=json&date=2015:2016&per_page=4`, gaps],
] as const

const http = (respond: (url: string) => Response) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, respond(request.url))),
    ),
  )

const replay = (respond: (url: string) => Response) =>
  WorldBank.layer.pipe(Layer.provide(http(respond)))

const fromRecording = (url: string) => {
  const match = recorded.find(([recordedUrl]) => recordedUrl === url)

  return match === undefined
    ? new Response("no recording", { status: 404 })
    : Response.json(match[1])
}

const recording = replay((url) => {
  const match = recorded.find(([recordedUrl]) => recordedUrl === url)

  return match === undefined
    ? new Response("no recording", { status: 404 })
    : Response.json(match[1])
})

const gdp = {
  indicator: IndicatorId.make("NY.GDP.PCAP.CD"),
  countries: ["FRA", "SSD"] as const,
  from: Year.make(2015),
  to: Year.make(2016),
}

describe("WorldBank", () => {
  it.effect("describes an indicator from its metadata", () =>
    Effect.gen(function* () {
      const described = yield* (yield* WorldBank).describe(IndicatorId.make("SP.POP.TOTL"))

      expect(described.indicator.name).toBe("Population, total")
      expect(described.indicator.definition).toMatch(/^Total population is based on/)
      expect(described.dataset).toBe("World Development Indicators")
    }).pipe(Effect.provide(recording)),
  )

  it.effect("reports an unknown indicator", () =>
    Effect.gen(function* () {
      const error = yield* (yield* WorldBank)
        .describe(IndicatorId.make("NOT.A.REAL"))
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(IndicatorNotFound)
    }).pipe(Effect.provide(recording)),
  )

  it.effect("drops the years a country has no value for", () =>
    Effect.gen(function* () {
      const series = yield* (yield* WorldBank).observations(gdp)

      expect(series.observations).toEqual([
        { country: "FRA", year: 2016, value: 37024.2157133669 },
        { country: "FRA", year: 2015, value: 36702.4323733379 },
        { country: "SSD", year: 2015, value: 1080.14718624765 },
      ])
      expect(series.url).toBe(
        `${base}/country/FRA;SSD/indicator/NY.GDP.PCAP.CD?format=json&date=2015:2016&per_page=4`,
      )
    }).pipe(Effect.provide(recording)),
  )

  it.effect("retries a failing source, then reports it unavailable", () => {
    let attempts = 0

    const failing = replay(() => {
      attempts += 1

      return new Response("upstream down", { status: 503 })
    })

    return Effect.gen(function* () {
      const fiber = yield* (yield* WorldBank).observations(gdp).pipe(Effect.flip, Effect.forkScoped)

      yield* TestClock.adjust("1 minute")

      const error = yield* Fiber.join(fiber)

      expect(error).toBeInstanceOf(SourceUnavailable)
      expect(attempts).toBe(3)
    }).pipe(Effect.provide(failing))
  })

  it.effect("reports a response it does not recognize as unavailable", () =>
    Effect.gen(function* () {
      const error = yield* (yield* WorldBank).observations(gdp).pipe(Effect.flip)

      expect(error).toBeInstanceOf(SourceUnavailable)
    }).pipe(Effect.provide(replay(() => Response.json({ unexpected: true })))),
  )
})

// The cached adapter over recorded responses, with an in-memory cache the
// test can inspect and a count of the requests that reached the World Bank.
const cachedRecording = () => {
  const store = new Map<string, string>()
  let requests = 0

  const layer = WorldBank.cached.pipe(
    Layer.provide(
      http((url) => {
        requests += 1

        return fromRecording(url)
      }),
    ),
    Layer.provide(
      Layer.succeed(
        Cache,
        Cache.of({
          get: (key) => Effect.sync(() => Option.fromNullishOr(store.get(key))),
          put: (key, value) =>
            Effect.sync(() => {
              store.set(key, value)
            }),
        }),
      ),
    ),
  )

  return { layer, store, requests: () => requests }
}

describe("WorldBank.cached", () => {
  it.effect("serves a repeat request from the cache with its original retrieval time", () => {
    const world = cachedRecording()

    return Effect.gen(function* () {
      const worldBank = yield* WorldBank
      const first = yield* worldBank.observations(gdp)

      yield* TestClock.adjust("1 hour")

      const second = yield* worldBank.observations({ ...gdp, countries: ["SSD", "FRA"] })

      expect(world.requests()).toBe(1)
      expect(second.observations).toEqual(first.observations)
      expect(DateTime.toEpochMillis(second.retrievedAt)).toBe(
        DateTime.toEpochMillis(first.retrievedAt),
      )
    }).pipe(Effect.provide(world.layer))
  })

  it.effect("asks the World Bank again once a stored result is a day old", () => {
    const world = cachedRecording()

    return Effect.gen(function* () {
      const worldBank = yield* WorldBank
      const first = yield* worldBank.observations(gdp)

      yield* TestClock.adjust("25 hours")

      const second = yield* worldBank.observations(gdp)

      expect(world.requests()).toBe(2)
      expect(DateTime.toEpochMillis(second.retrievedAt)).toBeGreaterThan(
        DateTime.toEpochMillis(first.retrievedAt),
      )
    }).pipe(Effect.provide(world.layer))
  })

  it.effect("asks again when a stored entry no longer decodes", () => {
    const world = cachedRecording()

    return Effect.gen(function* () {
      const worldBank = yield* WorldBank

      yield* worldBank.describe(IndicatorId.make("SP.POP.TOTL"))

      for (const key of world.store.keys())
        world.store.set(key, `{"shape":"from an older release"}`)

      const described = yield* worldBank.describe(IndicatorId.make("SP.POP.TOTL"))

      expect(world.requests()).toBe(2)
      expect(described.indicator.name).toBe("Population, total")
    }).pipe(Effect.provide(world.layer))
  })
})
