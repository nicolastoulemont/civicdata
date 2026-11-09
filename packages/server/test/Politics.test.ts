import {
  Api,
  type Country,
  Day,
  End,
  type Government,
  PoliticsUnavailable,
  Year,
} from "@civicdata/domain"
import { beforeEach, describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { HttpServer } from "effect/http"
import { HttpApiTest } from "effect/http-api"

import { ArchiveUnavailable } from "../src/Archives.ts"
import { Politics, PoliticsRoutes } from "../src/Politics.ts"
import { PoliticsBuild, PoliticsBuildFailed } from "../src/PoliticsBuild.ts"
import { build, emptyPolitics, gone, type Files, politicsOver, recorded } from "./politics.ts"

beforeEach(emptyPolitics)

// The politics routes with real records over D1, built from the recorded
// files.
const serve = (files: Files) =>
  Layer.mergeAll(PoliticsRoutes, HttpServer.layerServices).pipe(
    Layer.provideMerge(politicsOver(files)),
  )

const records = (countries: readonly [Country, ...Array<Country>], from: number, to: number) =>
  Effect.flatMap(HttpApiTest.groups(Api, ["politics"]), (client) =>
    client.politics.records({ query: { countries, from: Year.make(from), to: Year.make(to) } }),
  )

const heads = (governments: ReadonlyArray<Government>) =>
  governments.map((government) => government.head)

const next = (day: string) => End.cases.Next.make({ day: Day.make(day) })

describe("politics", () => {
  it.effect("answers the governments in office during the years, with their sources", () =>
    Effect.gen(function* () {
      yield* build(1)

      const { governments } = yield* records(["ESP"], 2015, 2016)

      expect(heads(governments)).toEqual(["Mariano Rajoy", "Mariano Rajoy", "Mariano Rajoy"])
      expect(governments[0]).toMatchObject({
        country: "ESP",
        start: "2011-12-21",
        end: next("2015-12-20"),
        parties: [{ name: "People's Party", abbreviation: "PP" }],
        citation: { publisher: "PPEG", url: "https://ppeg.wzb.eu/www/ppeg_gov_2025v1.zip" },
      })
      // Independents in the cabinet govern too; the head's party comes first.
      expect(governments[2]?.parties.map((party) => party.abbreviation)).toEqual(["PP", null])
    }).pipe(Effect.provide(serve(recorded()))),
  )

  it.effect("keeps a government in office when the archive ends to its cutoff", () =>
    Effect.gen(function* () {
      yield* build(1)

      const { governments } = yield* records(["ESP"], 2024, 2025)

      expect(governments).toHaveLength(1)
      expect(governments[0]).toMatchObject({
        head: "Pedro Sánchez",
        start: "2023-11-16",
        end: End.cases.Cutoff.make({ day: Day.make("2025-10-31") }),
      })
    }).pipe(Effect.provide(serve(recorded()))),
  )

  it.effect("answers no governments for a country without records", () =>
    Effect.gen(function* () {
      yield* build(1)

      expect(yield* records(["BRA"], 2000, 2020)).toEqual({ governments: [], elections: [] })
    }).pipe(Effect.provide(serve(recorded()))),
  )

  it.effect("prefers PPEG to ParlGov where both record a government", () =>
    Effect.gen(function* () {
      yield* build(1)

      const { governments } = yield* records(["ESP"], 2012, 2012)

      // ParlGov names the same cabinet "Rajoy I", from the same day.
      expect(heads(governments)).toEqual(["Mariano Rajoy"])
      expect(governments[0]?.citation.publisher).toBe("PPEG")
    }).pipe(Effect.provide(serve(recorded()))),
  )

  it.effect("reads a country PPEG does not cover from ParlGov", () =>
    Effect.gen(function* () {
      yield* build(1)

      const { governments } = yield* records(["CAN"], 2016, 2016)

      expect(governments).toMatchObject([
        {
          head: "Trudeau J",
          start: "2015-11-04",
          end: next("2019-10-21"),
          parties: [{ name: "Liberal Party of Canada", abbreviation: "LP" }],
          citation: { publisher: "ParlGov", url: "https://parlgov.fly.dev/data-csv/data_cabinet/" },
        },
      ])
    }).pipe(Effect.provide(serve(recorded()))),
  )

  it.effect("follows the archives with governments checked by hand, whose end is open", () =>
    Effect.gen(function* () {
      yield* build(1)

      const { governments } = yield* records(["NLD"], 2025, 2026)

      // PPEG names the same head two ways.
      expect(governments.map(({ head, start, end }) => ({ head, start, end }))).toEqual([
        { head: "Hendrikus Schoof", start: "2024-07-02", end: next("2025-06-03") },
        { head: "Dick Schoof", start: "2025-06-03", end: next("2025-08-22") },
        { head: "Dick Schoof", start: "2025-08-22", end: next("2026-02-23") },
        { head: "Rob Jetten", start: "2026-02-23", end: End.cases.Open.make({}) },
      ])
      // Checked by hand without establishing who governed with him.
      expect(governments[2]?.parties).toEqual([])
      expect(governments[3]?.citation.publisher).toBe("Official")
    }).pipe(Effect.provide(serve(recorded()))),
  )

  it.effect("answers a country's elections held in the years, with sources", () =>
    Effect.gen(function* () {
      yield* build(1)

      const { elections } = yield* records(["ESP"], 2015, 2016)

      expect(elections).toMatchObject([
        { ballot: "parliament", date: "2015-12-20", lastRound: null },
        { ballot: "parliament", date: "2016-06-26", lastRound: null },
      ])
      expect(elections[0]?.citation).toMatchObject({
        publisher: "PPEG",
        url: "https://ppeg.wzb.eu/www/ppeg_parl_2025v1.zip",
      })
    }).pipe(Effect.provide(serve(recorded()))),
  )

  it.effect("prefers PPEG to ParlGov where both record an election, even on other days", () =>
    Effect.gen(function* () {
      yield* build(1)

      const { elections } = yield* records(["FRA"], 2017, 2017)

      // ParlGov dates the same parliamentary election by its second round,
      // 18 June; PPEG by its first.
      expect(elections.map(({ ballot, date, lastRound }) => ({ ballot, date, lastRound }))).toEqual(
        [
          { ballot: "president", date: "2017-04-23", lastRound: "2017-05-07" },
          { ballot: "parliament", date: "2017-06-11", lastRound: null },
        ],
      )
    }).pipe(Effect.provide(serve(recorded()))),
  )

  it.effect("reads elections PPEG does not cover from ParlGov, without European ones", () =>
    Effect.gen(function* () {
      yield* build(1)

      expect((yield* records(["CAN"], 2015, 2015)).elections).toMatchObject([
        { ballot: "parliament", date: "2015-10-19", citation: { publisher: "ParlGov" } },
      ])
      // ParlGov's 2014 European Parliament election in Spain is not national.
      expect((yield* records(["ESP"], 2014, 2014)).elections).toEqual([])
    }).pipe(Effect.provide(serve(recorded()))),
  )

  it.effect("follows the archives with elections checked by hand, by their rounds", () =>
    Effect.gen(function* () {
      yield* build(1)

      const { elections } = yield* records(["PRT", "EST"], 2026, 2026)

      expect(elections).toMatchObject([
        {
          country: "PRT",
          ballot: "president",
          date: "2026-01-18",
          lastRound: "2026-02-08",
          citation: { publisher: "Official" },
        },
        { country: "EST", ballot: "president-indirect", date: "2026-09-02", lastRound: null },
      ])
    }).pipe(Effect.provide(serve(recorded()))),
  )

  it.effect("is unavailable before a build stores any records", () =>
    Effect.gen(function* () {
      const error = yield* records(["ESP"], 2015, 2016).pipe(Effect.flip)

      expect(error).toEqual(new PoliticsUnavailable())
    }).pipe(Effect.provide(serve(recorded()))),
  )

  it.effect("keeps a publisher's records while it is down, and stores the others", () => {
    const files = recorded()

    return Effect.gen(function* () {
      yield* build(1)
      files["https://parlgov.fly.dev/data-csv/data_cabinet/"] = gone

      const error = yield* build(2).pipe(Effect.flip)

      expect(error).toEqual(
        new PoliticsBuildFailed({ datasets: [{ records: "governments", publisher: "ParlGov" }] }),
      )
      expect(heads((yield* records(["CAN"], 2016, 2016)).governments)).toEqual(["Trudeau J"])
      expect(heads((yield* records(["ESP"], 2012, 2012)).governments)).toEqual(["Mariano Rajoy"])
    }).pipe(Effect.provide(serve(files)))
  })

  it.effect("rejects an archive whose rows do not decode, storing nothing", () =>
    Effect.gen(function* () {
      const error = yield* (yield* PoliticsBuild)
        .write({ records: "governments", publisher: "ParlGov" }, 1)
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(ArchiveUnavailable)
      expect(
        yield* (yield* Politics)
          .records({
            countries: ["CAN"],
            from: Year.make(2016),
            to: Year.make(2016),
          })
          .pipe(Effect.flip),
      ).toEqual(new PoliticsUnavailable())
    }).pipe(
      Effect.provide(
        politicsOver(
          recorded({
            // A cabinet whose start is not a day.
            "https://parlgov.fly.dev/data-csv/data_cabinet/": () =>
              new Response("id,name,start_date,country_id\n1176,Trudeau J I,4 Nov 2015,29\n"),
          }),
        ),
      ),
    ),
  )
})
