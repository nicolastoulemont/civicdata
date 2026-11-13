import { describe, expect, it } from "@effect/vitest"
import { IndicatorId, IndicatorNotFound, SourceUnavailable, Year } from "@repo/domain"
import { DateTime, Effect, Fiber, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"

import { entry } from "../../catalog/tests/catalog.ts"
import { AssetId } from "../../series/Adapter.ts"
import { type SeriesBucket, Store } from "../../series/Store.ts"
import { http, memory } from "../../tests/fakes.ts"
import catalog from "../../tests/fixtures/worldbank/catalog.json"
import gaps from "../../tests/fixtures/worldbank/gaps.json"
import unknownIndicator from "../../tests/fixtures/worldbank/indicator-unknown.json"
import population from "../../tests/fixtures/worldbank/indicator.json"
import sources from "../../tests/fixtures/worldbank/sources.json"
import wgiGaps from "../../tests/fixtures/worldbank/wgi-gaps.json"
import corruption from "../../tests/fixtures/worldbank/wgi-indicator.json"
import { Sources } from "../Sources.ts"
import { WorldBank } from "../WorldBank.ts"
import { bucket, bulk, charts, recorded as bulks, serving } from "./series.ts"

const base = "https://api.worldbank.org/v2"

// The World Bank's gather, as its policy stores every indicator.
const mirror = Effect.flatMap(WorldBank, ({ bulk: units }) =>
  units === undefined || units.changed === undefined
    ? Effect.die("The World Bank stores nothing")
    : Effect.succeed({
        changed: units.changed,
        gather: (item: ReturnType<typeof entry>, version: string) =>
          units
            .gather(AssetId.make(item.indicator), { version, entries: [item] })
            .pipe(Stream.flatMap(({ series }) => series)),
      }),
)

const total = entry("SP.POP.TOTL", "Population, total")

// Recorded World Bank responses, served by URL.
const recorded = [
  [`${base}/indicator/SP.POP.TOTL?format=json`, population],
  [`${base}/indicator/NOT.A.REAL?format=json`, unknownIndicator],
  [`${base}/country/FRA;SSD/indicator/NY.GDP.PCAP.CD?format=json&date=2015:2016&per_page=4`, gaps],
  [`${base}/indicator?format=json&source=2&per_page=20000`, catalog],
  [`${base}/indicator/GOV_WGI_CC_EST?format=json`, corruption],
  [`${base}/country/HUN/indicator/GOV_WGI_CC_EST?format=json&date=1996:2002&per_page=7`, wgiGaps],
  [`${base}/sources/2?format=json`, sources],
] as const

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
  dimensions: {},
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
      const series = yield* (yield* WorldBank).fetch(gdp)

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

  it.effect("credits a governance series to the Worldwide Governance Indicators", () =>
    Effect.gen(function* () {
      const described = yield* (yield* WorldBank).describe(IndicatorId.make("GOV_WGI_CC_EST"))

      expect(described.dataset).toBe("Worldwide Governance Indicators")
      expect(described.indicator.definition).toMatch(/ranging from approximately -2\.5 to 2\.5/)
    }).pipe(Effect.provide(recording)),
  )

  it.effect("leaves out the years the Worldwide Governance Indicators skip", () =>
    Effect.gen(function* () {
      const series = yield* (yield* WorldBank).fetch({
        indicator: IndicatorId.make("GOV_WGI_CC_EST"),
        dimensions: {},
        countries: ["HUN"],
        from: Year.make(1996),
        to: Year.make(2002),
      })

      expect(series.observations.map(({ year }) => year)).toEqual([2002, 2000, 1998, 1996])
    }).pipe(Effect.provide(recording)),
  )

  it.effect("reads the day the World Development Indicators last changed", () =>
    Effect.gen(function* () {
      const { changed } = yield* mirror

      expect(yield* changed([total])).toEqual([{ asset: total.indicator, version: "2026-10-08" }])
    }).pipe(Effect.provide(recording)),
  )

  it.effect("reads every country's values from the bulk download, leaving out regions", () => {
    const asked: Array<string> = []

    const source = http((url) => {
      asked.push(url)

      return new Response(bulk(bulks.population))
    })

    return Effect.gen(function* () {
      const [series] = yield* Stream.runCollect((yield* mirror).gather(total, "2026-10-08"))

      expect(new Set(series?.observations.map(({ country }) => country))).toEqual(
        new Set(["DEU", "ESP", "FRA"]),
      )
      expect(
        series?.observations.find(({ country, year }) => country === "FRA" && year === 1960)?.value,
      ).toBe(47412964)
      expect(asked).toEqual([`${base}/en/indicator/SP.POP.TOTL?downloadformat=csv`])
    }).pipe(Effect.provide(WorldBank.layer.pipe(Layer.provide(source))))
  })

  it.effect("retries a bulk download for longer than a visitor's request", () => {
    let attempts = 0

    const flaky = http(() => {
      attempts += 1

      return attempts <= 3
        ? new Response("upstream down", { status: 503 })
        : new Response(bulk(bulks.population))
    })

    return Effect.gen(function* () {
      const fiber = yield* Stream.runCollect((yield* mirror).gather(total, "2026-10-08")).pipe(
        Effect.forkScoped,
      )

      yield* TestClock.adjust("1 minute")

      const [series] = yield* Fiber.join(fiber)

      expect(attempts).toBe(4)
      expect(series?.observations.length).toBeGreaterThan(0)
    }).pipe(Effect.provide(WorldBank.layer.pipe(Layer.provide(flaky))))
  })

  it.effect("gathers an indicator the bulk download does not know as an empty series", () => {
    const source = serving({ version: "2026-10-08", answers: new Map() })

    return Effect.gen(function* () {
      const gathered = yield* Stream.runCollect(
        (yield* mirror).gather(entry("NOT.A.REAL", "Not a real indicator"), "2026-10-08"),
      )

      expect(gathered.map(({ observations }) => observations)).toEqual([[]])
    }).pipe(Effect.provide(WorldBank.layer.pipe(Layer.provide(source.layer))))
  })

  it.effect("lists the World Development Indicators with their definitions", () =>
    Effect.gen(function* () {
      const indicators = yield* (yield* WorldBank).list

      expect(indicators).toHaveLength(6)
      expect(indicators.find((indicator) => indicator.indicator === "SP.POP.TOTL")?.name).toBe(
        "Population, total",
      )
      expect(indicators.every((indicator) => indicator.definition.length > 0)).toBe(true)
    }).pipe(Effect.provide(recording)),
  )

  it.effect("retries a failing source, then reports it unavailable", () => {
    let attempts = 0

    const failing = replay(() => {
      attempts += 1

      return new Response("upstream down", { status: 503 })
    })

    return Effect.gen(function* () {
      const fiber = yield* (yield* WorldBank).fetch(gdp).pipe(Effect.flip, Effect.forkScoped)

      yield* TestClock.adjust("1 minute")

      const error = yield* Fiber.join(fiber)

      expect(error).toBeInstanceOf(SourceUnavailable)
      expect(attempts).toBe(3)
    }).pipe(Effect.provide(failing))
  })

  it.effect("reports a response it does not recognize as unavailable", () =>
    Effect.gen(function* () {
      const error = yield* (yield* WorldBank).fetch(gdp).pipe(Effect.flip)

      expect(error).toBeInstanceOf(SourceUnavailable)
    }).pipe(Effect.provide(replay(() => Response.json({ unexpected: true })))),
  )
})

// The cached adapter over recorded responses, with an in-memory cache the
// test can inspect and a count of the requests that reached the World Bank.
const cachedRecording = () => {
  const { store, layer: cache } = memory()
  let requests = 0

  const layer = WorldBank.cached.pipe(
    Layer.provide(
      http((url) => {
        requests += 1

        return fromRecording(url)
      }),
    ),
    Layer.provide(cache),
  )

  return { layer, store, requests: () => requests }
}

describe("WorldBank.cached", () => {
  it.effect("serves a repeat request from the cache with its original retrieval time", () => {
    const world = cachedRecording()

    return Effect.gen(function* () {
      const worldBank = yield* WorldBank
      const first = yield* worldBank.fetch(gdp)

      yield* TestClock.adjust("1 hour")

      const second = yield* worldBank.fetch({ ...gdp, countries: ["SSD", "FRA"] })

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
      const first = yield* worldBank.fetch(gdp)

      yield* TestClock.adjust("25 hours")

      const second = yield* worldBank.fetch(gdp)

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

// A stored series of GDP per capita: France and South Sudan, 2014 to 2016.
const storedGdp = {
  indicator: {
    id: gdp.indicator,
    name: "GDP per capita (current US$)",
    definition: "GDP divided by population.",
  },
  dataset: "World Development Indicators",
  dimensions: {},
  version: "2026-10-08",
  retrievedAt: DateTime.makeUnsafe("2026-10-09T05:00:00Z"),
  observations: [
    { country: "FRA", year: Year.make(2014), value: 43000 },
    { country: "FRA", year: Year.make(2015), value: 36702 },
    { country: "FRA", year: Year.make(2016), value: 37024 },
    { country: "SSD", year: Year.make(2015), value: 1080 },
  ],
} as const

const storing = (store: SeriesBucket) =>
  Effect.gen(function* () {
    yield* Stream.runDrain((yield* Store).write(gdp.indicator, Stream.make(storedGdp)))
  }).pipe(Effect.provide(Store.r2(store)))

const failing: SeriesBucket = {
  get: () => Promise.reject(new Error("R2 is down")),
  put: () => Promise.reject(new Error("R2 is down")),
  delete: () => Promise.reject(new Error("R2 is down")),
}

describe("Sources.stored with the World Bank", () => {
  it.effect("draws a stored series without asking the World Bank", () => {
    const store = bucket()
    // A World Bank with nothing published: any request it gets is counted.
    const source = serving({ version: "2026-10-08", answers: new Map() })

    return Effect.gen(function* () {
      yield* storing(store.bucket)

      const worldBank = (yield* Sources)["World Bank"]
      const series = yield* worldBank.fetch(gdp)
      const described = yield* worldBank.describe(gdp.indicator)

      expect(source.requests()).toBe(0)
      expect(series.observations).toEqual([
        { country: "FRA", year: 2015, value: 36702 },
        { country: "FRA", year: 2016, value: 37024 },
        { country: "SSD", year: 2015, value: 1080 },
      ])
      // The link returns the chart's values; the time is the stored series'.
      expect(series.url).toBe(
        `${base}/country/FRA;SSD/indicator/NY.GDP.PCAP.CD?format=json&date=2015:2016&per_page=4`,
      )
      expect(DateTime.formatIso(series.retrievedAt)).toBe("2026-10-09T05:00:00.000Z")
      expect(described.indicator.name).toBe("GDP per capita (current US$)")
      expect(described.dataset).toBe("World Development Indicators")
    }).pipe(Effect.provide(charts(source.layer, store.bucket)))
  })

  it.effect("asks the World Bank for an indicator with no stored series", () => {
    let requests = 0

    const source = http((url) => {
      requests += 1

      return fromRecording(url)
    })

    return Effect.gen(function* () {
      const series = yield* (yield* Sources)["World Bank"].fetch({
        indicator: IndicatorId.make("GOV_WGI_CC_EST"),
        dimensions: {},
        countries: ["HUN"],
        from: Year.make(1996),
        to: Year.make(2002),
      })

      expect(requests).toBe(1)
      expect(series.observations).toHaveLength(4)
    }).pipe(Effect.provide(charts(source, bucket().bucket)))
  })

  it.effect("asks the World Bank when the store fails", () => {
    let requests = 0

    const source = http((url) => {
      requests += 1

      return fromRecording(url)
    })

    return Effect.gen(function* () {
      const series = yield* (yield* Sources)["World Bank"].fetch(gdp)

      expect(requests).toBe(1)
      expect(series.observations).toHaveLength(3)
    }).pipe(Effect.provide(charts(source, failing)))
  })
})
