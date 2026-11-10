import {
  Dimensions,
  IndicatorId,
  type IndicatorNotes,
  IndicatorNotes as IndicatorNotesSchema,
  IndicatorNotFound,
  SourceUnavailable,
} from "@civicdata/domain"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { strToU8, zipSync } from "fflate"

import { Cache } from "../src/Cache.ts"
import { Notes } from "../src/Notes.ts"
import unemploymentEsms from "./fixtures/eurostat/unemployment-esms.sdmx.xml?raw"
import unemploymentFlow from "./fixtures/eurostat/unemployment-flow.json"
import unknownFlow from "./fixtures/eurostat/unknown-flow.json"
import oecdUnemployment from "./fixtures/oecd/unemployment-notes.csv?raw"
import withoutLimitations from "./fixtures/worldbank/notes-without-limitations.json"
import lifeExpectancy from "./fixtures/worldbank/notes.json"
import corruption from "./fixtures/worldbank/wgi-notes.json"

// What the World Bank answers, with HTTP 200, for a series it does not have.
const unknown = `<?xml version="1.0" encoding="utf-8"?><wb:error xmlns:wb="http://www.worldbank.org"><wb:message id="160" key="Data not found.">The provided parameter value is not valid or data not found.</wb:message></wb:error>`

const worldBank = (indicator: string) =>
  `https://api.worldbank.org/v2/sources/2/series/${indicator}/metadata?format=json`

const eurostatFlow = (id: string) =>
  `https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/dataflow/ESTAT/${id}/1.0?format=JSON`

// The link UNE_RT_A's dataflow gives to its reference metadata.
const lfsiEsms =
  "https://ec.europa.eu/eurostat/api/dissemination/files?file=metadata/lfsi_esms.sdmx.zip"

const oecdNotes = (flow: string) =>
  `https://sdmx.oecd.org/public/rest/v2/data/dataflow/OECD.SDD.TPS/${flow}/1.0/*?attributes=msd&measures=none`

// The ESMS file Eurostat recorded on 2026-11-10, zipped as it serves it, with
// the HTML page and annexes the real zip also holds left out.
const lfsiZip = zipSync({ "lfsi_esms.sdmx.xml": strToU8(unemploymentEsms) })

// Recorded source responses, served by URL, counting the requests.
const recorded = () => {
  const store = new Map<string, string>()
  let requests = 0

  const respond = (requested: string) => {
    requests += 1

    const answers = new Map<string, () => Response>([
      [worldBank("SP.DYN.LE00.IN"), () => Response.json(lifeExpectancy)],
      [worldBank("NY.GDP.PCAP.CD"), () => Response.json(withoutLimitations)],
      [worldBank("GOV_WGI_CC_EST"), () => Response.json(corruption)],
      [
        worldBank("NOT.A.REAL"),
        () => new Response(unknown, { headers: { "content-type": "text/xml" } }),
      ],
      [eurostatFlow("UNE_RT_A"), () => Response.json(unemploymentFlow)],
      [eurostatFlow("NOPE"), () => Response.json(unknownFlow, { status: 404 })],
      [lfsiEsms, () => new Response(lfsiZip)],
      [oecdNotes("DSD_LFS@DF_IALFS_UNE_M"), () => new Response(oecdUnemployment)],
      [oecdNotes("DSD_LFS@DF_NOPE"), () => new Response(null, { status: 204 })],
    ])

    return answers.get(requested)?.() ?? new Response("no recording", { status: 404 })
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

const read = (indicator: string, scope?: Parameters<Notes["Service"]["get"]>[1]) =>
  Effect.gen(function* () {
    const notes = yield* Notes

    return yield* notes.get(IndicatorId.make(indicator), scope)
  })

// The notes of one source, or a failed test.
const narrow =
  <A extends IndicatorNotes>(guard: (notes: IndicatorNotes) => notes is A) =>
  (notes: IndicatorNotes) => {
    if (!guard(notes)) throw new Error(`${notes._tag} notes`)

    return notes
  }

const { guards } = IndicatorNotesSchema

const worldBankNotes = narrow(guards["World Bank"])
const eurostatNotes = narrow(guards.Eurostat)
const oecdNotesOf = narrow(guards.OECD)

describe("World Bank notes", () => {
  it.effect("reads why an indicator matters, its limitations and its methodology", () =>
    Effect.gen(function* () {
      const notes = worldBankNotes(yield* read("SP.DYN.LE00.IN"))

      expect(notes.relevance).toMatch(/^Mortality rates for different age groups/)
      expect(notes.limitations).toMatch(/^Annual data series from United Nations Population/)
      expect(notes.methodology).toMatch(
        /^Methodology: Life expectancy at birth is derived from life tables/,
      )
      expect(notes.url).toBe(worldBank("SP.DYN.LE00.IN"))
    }).pipe(Effect.provide(recorded().layer)),
  )

  it.effect("reads no limitations or producer when the World Bank lists none", () =>
    Effect.gen(function* () {
      const notes = worldBankNotes(yield* read("NY.GDP.PCAP.CD"))

      expect(notes.relevance).toMatch(/^This indicator is related to the national accounts/)
      expect(notes.limitations).toBeNull()
      // Its Source field names producers but links no page.
      expect(notes.producer).toBeNull()
    }).pipe(Effect.provide(recorded().layer)),
  )

  it.effect("links the page of who produced the series", () =>
    Effect.gen(function* () {
      const notes = worldBankNotes(yield* read("GOV_WGI_CC_EST"))

      expect(notes.producer).toEqual({
        name: "The Worldwide Governance Indicators: Revised Methodology for Measuring Governance Using Perception Data., World Bank Group (WBG)",
        url: "https://www.worldbank.org/en/publication/worldwide-governance-indicators",
      })
    }).pipe(Effect.provide(recorded().layer)),
  )

  it.effect("fails with IndicatorNotFound for a series the World Bank does not have", () =>
    Effect.gen(function* () {
      expect(yield* read("NOT.A.REAL").pipe(Effect.flip)).toBeInstanceOf(IndicatorNotFound)
    }).pipe(Effect.provide(recorded().layer)),
  )

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

describe("Eurostat notes", () => {
  it.effect("reads the reference metadata the dataflow links, with its URL", () =>
    Effect.gen(function* () {
      const notes = eurostatNotes(yield* read("ESTAT,UNE_RT_A,1.0"))

      expect(notes.comparability.time).toMatch(
        /^From 2006 onwards, Commission Regulation \(EC\) No 430\/2005/,
      )
      expect(notes.comparability.time).toContain(
        "The changes in the derivation of the labour status can cause breaks in the time series",
      )
      expect(notes.comparability.countries).toContain(
        "Spain: Pre-IESS, and after the outbreak of the COVID crisis",
      )
      expect(notes.coherence).toMatch(/^The ESMS page on 'Employment and unemployment \(LFS\)'/)
      expect(notes.url).toBe(lfsiEsms)
    }).pipe(Effect.provide(recorded().layer)),
  )

  it.effect("reads each section as plain text, without the HTML Eurostat writes", () =>
    Effect.gen(function* () {
      const notes = eurostatNotes(yield* read("ESTAT,UNE_RT_A,1.0"))

      expect([notes.concepts, notes.accuracy, notes.comparability.time].join("")).not.toMatch(
        /<|&[a-z]+;/,
      )
    }).pipe(Effect.provide(recorded().layer)),
  )

  it.effect("fails with IndicatorNotFound for a dataflow Eurostat does not have", () =>
    Effect.gen(function* () {
      expect(yield* read("ESTAT,NOPE,1.0").pipe(Effect.flip)).toBeInstanceOf(IndicatorNotFound)
    }).pipe(Effect.provide(recorded().layer)),
  )
})

describe("OECD notes", () => {
  const unemployment = "OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0"

  it.effect("reads the notes on every country and on the countries asked, with the URL", () =>
    Effect.gen(function* () {
      const notes = oecdNotesOf(yield* read(unemployment, { countries: ["IRL"] }))

      expect(notes.notes.map(({ country }) => country)).toEqual([null, "IRL"])
      expect(notes.notes[0]?.concepts).toMatch(
        /^The unemployment rate is the ratio of number of persons unemployed/,
      )
      expect(notes.notes[1]?.quality).toContain(
        "The Quarterly National Household Survey was discontinued in Q2 2017",
      )
      expect(notes.url).toBe(oecdNotes("DSD_LFS@DF_IALFS_UNE_M"))
    }).pipe(Effect.provide(recorded().layer)),
  )

  it.effect("reads a note's English text, with its series", () =>
    Effect.gen(function* () {
      const notes = oecdNotesOf(yield* read(unemployment, { countries: ["RUS"] }))

      expect(notes.notes.find(({ country }) => country === "RUS")).toEqual({
        country: "RUS",
        series: { MEASURE: "UNE_LF_M", UNIT_MEASURE: "PT_LF_SUB" },
        concepts: null,
        quality:
          "eBreak between 2016 and 2017: Data until December 2016 for '15 and over' age group refer to people aged 15-72.",
        limitations: null,
        comment: null,
      })
    }).pipe(Effect.provide(recorded().layer)),
  )

  it.effect("leaves out notes on another series, and on groups of countries", () =>
    Effect.gen(function* () {
      const notes = oecdNotesOf(
        yield* read(unemployment, {
          countries: ["FRA"],
          dimensions: Schema.decodeSync(Dimensions)({ MEASURE: "EMP" }),
        }),
      )

      expect(notes.notes).toEqual([])
    }).pipe(Effect.provide(recorded().layer)),
  )

  it.effect("reads no notes for a dataflow the OECD has none for", () =>
    Effect.gen(function* () {
      expect(oecdNotesOf(yield* read("OECD.SDD.TPS,DSD_LFS@DF_NOPE,1.0")).notes).toEqual([])
    }).pipe(Effect.provide(recorded().layer)),
  )
})
