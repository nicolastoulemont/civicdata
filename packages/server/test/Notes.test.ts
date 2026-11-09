import { IndicatorId, IndicatorNotFound, SourceUnavailable } from "@civicdata/domain"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"

import { Cache } from "../src/Cache.ts"
import { Notes } from "../src/Notes.ts"
import withoutLimitations from "./fixtures/worldbank/notes-without-limitations.json"
import lifeExpectancy from "./fixtures/worldbank/notes.json"

// What the World Bank answers, with HTTP 200, for a series it does not have.
const unknown = `<?xml version="1.0" encoding="utf-8"?><wb:error xmlns:wb="http://www.worldbank.org"><wb:message id="160" key="Data not found.">The provided parameter value is not valid or data not found.</wb:message></wb:error>`

const url = (indicator: string) =>
  `https://api.worldbank.org/v2/sources/2/series/${indicator}/metadata?format=json`

// Recorded World Bank responses, served by URL, counting the requests.
const recorded = () => {
  const store = new Map<string, string>()
  let requests = 0

  const respond = (requested: string) => {
    requests += 1

    if (requested === url("SP.DYN.LE00.IN")) return Response.json(lifeExpectancy)

    if (requested === url("NY.GDP.PCAP.CD")) return Response.json(withoutLimitations)

    if (requested === url("NOT.A.REAL")) {
      return new Response(unknown, { headers: { "content-type": "text/xml" } })
    }

    return new Response("no recording", { status: 404 })
  }

  const layer = Notes.layer.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, respond(request.url))),
        ),
      ),
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

  return { layer, requests: () => requests }
}

const read = (indicator: string) =>
  Effect.gen(function* () {
    const notes = yield* Notes

    return yield* notes.get(IndicatorId.make(indicator))
  })

describe("Notes", () => {
  it.effect("reads why an indicator matters and its limitations", () =>
    Effect.gen(function* () {
      const notes = yield* read("SP.DYN.LE00.IN")

      expect(notes.relevance).toMatch(/^Mortality rates for different age groups/)
      expect(notes.limitations).toMatch(/^Annual data series from United Nations Population/)
      expect(notes.url).toBe(url("SP.DYN.LE00.IN"))
    }).pipe(Effect.provide(recorded().layer)),
  )

  it.effect("reads no limitations when the World Bank lists none", () =>
    Effect.gen(function* () {
      const notes = yield* read("NY.GDP.PCAP.CD")

      expect(notes.relevance).toMatch(/^This indicator is related to the national accounts/)
      expect(notes.limitations).toBeNull()
    }).pipe(Effect.provide(recorded().layer)),
  )

  it.effect("fails with IndicatorNotFound for a series the World Bank does not have", () =>
    Effect.gen(function* () {
      expect(yield* read("NOT.A.REAL").pipe(Effect.flip)).toBeInstanceOf(IndicatorNotFound)
    }).pipe(Effect.provide(recorded().layer)),
  )

  it.effect("fails with IndicatorNotFound for a Eurostat indicator, without asking", () => {
    const world = recorded()

    return Effect.gen(function* () {
      expect(yield* read("ESTAT,UNE_RT_A,1.0").pipe(Effect.flip)).toBeInstanceOf(IndicatorNotFound)
      expect(world.requests()).toBe(0)
    }).pipe(Effect.provide(world.layer))
  })

  it.effect("fails with SourceUnavailable when the World Bank errors", () =>
    Effect.gen(function* () {
      expect(yield* read("SP.POP.TOTL").pipe(Effect.flip)).toBeInstanceOf(SourceUnavailable)
    }).pipe(Effect.provide(recorded().layer)),
  )

  it.effect("serves stored notes for a week before asking the World Bank again", () => {
    const world = recorded()

    return Effect.gen(function* () {
      const first = yield* read("SP.DYN.LE00.IN")

      yield* TestClock.adjust("6 days")
      expect(yield* read("SP.DYN.LE00.IN")).toEqual(first)
      expect(world.requests()).toBe(1)

      yield* TestClock.adjust("2 days")
      yield* read("SP.DYN.LE00.IN")
      expect(world.requests()).toBe(2)
    }).pipe(Effect.provide(world.layer))
  })
})
