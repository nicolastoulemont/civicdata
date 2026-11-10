import { IndicatorId, IndicatorNotFound } from "@civicdata/domain"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import { gzipSync, strToU8 } from "fflate"

import { Eurostat, Unstorable } from "../src/Eurostat.ts"
import { http } from "./fakes.ts"
import notPublished from "./fixtures/eurostat/bulk-unknown.xml?raw"
import recordedContents from "./fixtures/eurostat/toc.txt?raw"
import { eurostatRecorded, file } from "./series.ts"

const uneRtA = IndicatorId.make("ESTAT,UNE_RT_A,1.0")
const current = IndicatorId.make("ESTAT,EI_BPM6CA_Q,1.0")
const gone = IndicatorId.make("ESTAT,NOPE_XYZ,1.0")
const flights = IndicatorId.make("ESTAT,AVIA_PAOC,1.0")
const routes = IndicatorId.make("ESTAT,AVIA_PAOA,1.0")

// A bulk file with a dimension after geo, as Eurostat's flights list each
// country's partner countries: one partner's lines are spread over every
// reporting country's block.
const partners = [
  "freq,unit,geo,partner\\TIME_PERIOD\t2023 \t2024 ",
  "A,FLIGHT,AT,DE\t10 \t11 ",
  "A,FLIGHT,AT,FR\t20 \t21 ",
  "A,FLIGHT,DE,AT\t30 \t31 ",
  "A,FLIGHT,DE,FR\t40 \t41 p",
].join("\r\n")

// A block of 2,600 partners for each of four countries over twenty years:
// 208,000 values.
const crowded = [
  `freq,unit,geo,partner\\TIME_PERIOD\t${Array.from({ length: 20 }, (_, at) => `${2000 + at} `).join("\t")}`,
  ...["AT", "DE", "FR", "IT"].flatMap((country) =>
    Array.from(
      { length: 2600 },
      (_, at) => `A,FLIGHT,${country},P${at}\t${Array.from({ length: 20 }, () => "1 ").join("\t")}`,
    ),
  ),
].join("\n")

// Eurostat answering the recorded table of contents and bulk files.
const recording = http((address) => {
  const { pathname } = new URL(address)

  if (pathname.endsWith("/catalogue/toc/txt")) return new Response(recordedContents)

  if (pathname.endsWith("/data/UNE_RT_A")) return new Response(file(eurostatRecorded.unemployment))

  if (pathname.endsWith("/data/EI_BPM6CA_Q")) return new Response(file(eurostatRecorded.quarterly))

  if (pathname.endsWith("/data/AVIA_PAOC")) return new Response(gzipSync(strToU8(partners)))

  if (pathname.endsWith("/data/AVIA_PAOA")) return new Response(gzipSync(strToU8(crowded)))

  return new Response(notPublished, { status: 404 })
})

const eurostat = Eurostat.layer.pipe(Layer.provide(recording))

const series = Effect.fn(function* (indicator: IndicatorId) {
  return yield* Stream.runCollect((yield* Eurostat).series(indicator))
})

describe("Eurostat", () => {
  it.effect("dates each dataset's and table's release from the table of contents", () =>
    Effect.gen(function* () {
      const releases = yield* (yield* Eurostat).releases

      expect([...releases]).toEqual([
        ["EI_BPM6CA_Q", { version: "2026-10-28", size: 314_870 }],
        ["TPS00001", { version: "2026-10-27", size: 581 }],
        ["UNE_RT_A", { version: "2026-11-06", size: 38_655 }],
      ])
    }).pipe(Effect.provide(eurostat)),
  )

  it.effect("reads one series per combination of a dataset's dimensions, for our countries", () =>
    Effect.gen(function* () {
      const combinations = yield* series(uneRtA)

      expect(combinations.map(({ dimensions }) => dimensions)).toEqual([
        { age: "Y15-24", unit: "PC_ACT", sex: "F" },
        { age: "Y15-24", unit: "PC_ACT", sex: "M" },
        { age: "Y15-24", unit: "PC_ACT", sex: "T" },
      ])

      const [women] = combinations
      const countries = new Set(women?.observations.map(({ country }) => country))

      // Greece is EL at Eurostat; the EU is not a country.
      expect(countries).toEqual(new Set(["DEU", "GRC", "ESP", "FRA"]))
      expect(
        women?.observations.find(({ country, year }) => country === "DEU" && year === 2010),
      ).toEqual({ country: "DEU", year: 2010, value: 9.4, flags: ["Break"] })
      // ":" marks a year without a value.
      expect(
        women?.observations.some(({ country, year }) => country === "DEU" && year === 2003),
      ).toBe(false)
    }).pipe(Effect.provide(eurostat)),
  )

  it.effect("reads the series of a dataset whose dimensions continue after geo", () =>
    Effect.gen(function* () {
      const combinations = yield* series(flights)

      expect(combinations).toEqual([
        {
          dimensions: { unit: "FLIGHT", partner: "DE" },
          observations: [
            { country: "AUT", year: 2023, value: 10 },
            { country: "AUT", year: 2024, value: 11 },
          ],
        },
        {
          dimensions: { unit: "FLIGHT", partner: "FR" },
          observations: [
            { country: "AUT", year: 2023, value: 20 },
            { country: "AUT", year: 2024, value: 21 },
            { country: "DEU", year: 2023, value: 40 },
            { country: "DEU", year: 2024, value: 41, flags: ["Provisional"] },
          ],
        },
        {
          dimensions: { unit: "FLIGHT", partner: "AT" },
          observations: [
            { country: "DEU", year: 2023, value: 30 },
            { country: "DEU", year: 2024, value: 31 },
          ],
        },
      ])
    }).pipe(Effect.provide(eurostat)),
  )

  it.effect("finds a dataset too large when one block holds more values than a step can", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(series(routes))

      expect(error).toEqual(new Unstorable({ reason: "TooLarge" }))
    }).pipe(Effect.provide(eurostat)),
  )

  it.effect("finds no series in a dataset without annual values", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(series(current))

      expect(error).toEqual(new Unstorable({ reason: "NoAnnual" }))
    }).pipe(Effect.provide(eurostat)),
  )

  it.effect("answers that a dataset Eurostat does not publish is not found", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(series(gone))

      expect(error).toEqual(new IndicatorNotFound({ indicator: gone }))
    }).pipe(Effect.provide(eurostat)),
  )
})
