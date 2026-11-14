import { beforeEach, describe, expect, it } from "@effect/vitest"
import {
  Api,
  type Country,
  Day,
  End,
  type Government,
  PoliticsUnavailable,
  Year,
} from "@repo/domain"
import { reset } from "cloudflare:test"
import { Effect, Layer } from "effect"
import { HttpServer } from "effect/http"
import { HttpApiTest } from "effect/http-api"
import { TestClock } from "effect/testing"

import { steps } from "../../tests/fakes.ts"
import parlgovCabinets from "../../tests/fixtures/parlgov/data_cabinet.csv?raw"
import ppegGovernments from "../../tests/fixtures/ppeg/governments.csv?raw"
import { snapshot } from "../../tests/tables.ts"
import { ArchiveUnavailable } from "../Archives.schemas.ts"
import { Politics, PoliticsRoutes } from "../Politics.ts"
import { PoliticsBuildFailed } from "../PoliticsBuild.schemas.ts"
import { PoliticsBuild } from "../PoliticsBuild.ts"
import {
  build,
  dropFingerprints,
  forgetPartyIds,
  gone,
  type Files,
  politicsOver,
  published,
  recorded,
  zipped,
} from "./politics.ts"

// Every test starts from empty bindings: the test Worker's D1 database and
// buckets are shared by the file's tests.
beforeEach(() => reset())

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

// The ids of the events of a country's years.
const eventsOf = (country: Country, { from, to }: { from: number; to: number }) =>
  records([country], from, to).pipe(Effect.map(({ events }) => events.map((event) => event.id)))

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

      expect(yield* records(["BRA"], 2000, 2020)).toMatchObject({ governments: [], elections: [] })
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

  it.effect("colours a government by its head's party, joined by the publisher's party id", () =>
    Effect.gen(function* () {
      yield* build(1)

      const { governments } = yield* records(["ESP"], 2018, 2018)

      // PPEG's id for the People's Party has no colour; its id for the
      // Spanish Socialist Workers' Party has Wikidata's.
      expect(governments.map(({ head, color }) => ({ head, color }))).toEqual([
        { head: "Mariano Rajoy", color: null },
        {
          head: "Pedro Sánchez",
          color: {
            hex: "#EF1C27",
            kind: "representative",
            url: "https://www.wikidata.org/wiki/Q138198#P465",
          },
        },
      ])
    }).pipe(Effect.provide(serve(recorded()))),
  )

  it.effect("colours a ParlGov government by ParlGov's own party id", () =>
    Effect.gen(function* () {
      // PPEG records no government of Spain's, so they come from ParlGov.
      yield* build(1)

      const { governments } = yield* records(["ESP"], 2012, 2012)

      expect(governments[0]?.citation.publisher).toBe("ParlGov")
      expect(governments[0]?.color?.url).toBe("https://www.wikidata.org/wiki/Q185088#P465")
    }).pipe(
      Effect.provide(
        serve(
          recorded({
            "https://ppeg.wzb.eu/www/ppeg_gov_2025v1.zip": zipped(
              "ppeg_gov_2025v1",
              ppegGovernments
                .split("\n")
                .filter((line) => !line.startsWith('"ESP"'))
                .join("\n"),
            ),
          }),
        ),
      ),
    ),
  )

  it.effect("leaves a government uncoloured when its head's party has none or is not named", () =>
    Effect.gen(function* () {
      yield* build(1)

      const { governments } = yield* records(["NLD"], 2025, 2026)

      // PPEG names independents as Schoof's party; the record checked by hand
      // names no head's party.
      expect(governments.map(({ head, color }) => ({ head, color }))).toEqual([
        { head: "Hendrikus Schoof", color: null },
        { head: "Dick Schoof", color: null },
        { head: "Dick Schoof", color: null },
        { head: "Rob Jetten", color: null },
      ])
    }).pipe(Effect.provide(serve(recorded()))),
  )

  it.effect("reads governments stored before party ids were kept, without colours", () =>
    Effect.gen(function* () {
      yield* build(1)
      yield* forgetPartyIds

      const { governments } = yield* records(["ESP"], 2019, 2019)

      expect(governments.map(({ head, color }) => ({ head, color }))).toEqual([
        { head: "Pedro Sánchez", color: null },
        { head: "Pedro Sánchez", color: null },
      ])
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

  it.effect("answers the events of the years that concern the countries, with sources", () =>
    Effect.gen(function* () {
      yield* build(1)

      const { events } = yield* records(["FRA"], 1970, 1995)

      expect(events.map((event) => event.id)).toEqual([
        "oil-shock-1973",
        "oil-shock-1979",
        "maastricht-signature",
        "maastricht-force",
      ])
      expect(events[0]).toMatchObject({
        name: "First oil shock and recession",
        sources: [{ url: expect.stringMatching(/^https:/) }],
      })
    }).pipe(Effect.provide(serve(recorded()))),
  )

  it.effect("answers a worldwide event for any country, and others only where they apply", () =>
    Effect.gen(function* () {
      yield* build(1)

      expect(yield* eventsOf("BRA", { from: 2019, to: 2021 })).toEqual(["covid-emergency"])
      // German reunification concerns Germany only.
      expect(yield* eventsOf("FRA", { from: 1990, to: 1990 })).toEqual([])
      expect(yield* eventsOf("DEU", { from: 1990, to: 1990 })).toEqual(["german-reunification"])
      // Still going on, so in every year since it began.
      expect(yield* eventsOf("UKR", { from: 2025, to: 2025 })).toEqual(["ukraine-invasion"])
    }).pipe(Effect.provide(serve(recorded()))),
  )

  it.effect("answers the reforms the countries adopted or put in force in the years", () =>
    Effect.gen(function* () {
      yield* build(1)

      const { reforms } = yield* records(["FRA", "SWE"], 1999, 2010)

      expect(
        reforms.map(({ country, name, date, milestone }) => ({ country, name, date, milestone })),
      ).toEqual([
        { country: "FRA", name: "Fillon reform", date: "2003-08-21", milestone: "adopted" },
        { country: "FRA", name: "Woerth reform", date: "2010-11-09", milestone: "adopted" },
        { country: "SWE", name: "NDC system starts", date: "1999-01-01", milestone: "in-force" },
      ])
    }).pipe(Effect.provide(serve(recorded()))),
  )

  it.effect("is unavailable before a build stores any records", () =>
    Effect.gen(function* () {
      const error = yield* records(["ESP"], 2015, 2016).pipe(Effect.flip)

      expect(error).toEqual(new PoliticsUnavailable())
    }).pipe(Effect.provide(serve(recorded()))),
  )

  // A preview may read production's records, so answering writes nothing.
  it.effect("writes nothing to the records' database while answering", () =>
    Effect.gen(function* () {
      yield* build(1)

      const before = yield* snapshot

      yield* records(["ESP", "FRA"], 2000, 2020)

      expect(before.map(({ name }) => name)).toEqual(
        expect.arrayContaining(["governments", "elections", "politics_current"]),
      )
      expect(yield* snapshot).toEqual(before)
    }).pipe(Effect.provide(serve(recorded()))),
  )

  it.effect("is unavailable until a build stores every publisher's records of both kinds", () => {
    const files = recorded({ "https://parlgov.fly.dev/data-csv/data_cabinet/": gone })

    return Effect.gen(function* () {
      yield* build(1).pipe(Effect.flip)

      // ParlGov's elections are in, but not its governments, so Canada's
      // governments are unknown rather than none.
      expect(yield* records(["CAN"], 2016, 2016).pipe(Effect.flip)).toEqual(
        new PoliticsUnavailable(),
      )

      files["https://parlgov.fly.dev/data-csv/data_cabinet/"] =
        recorded()["https://parlgov.fly.dev/data-csv/data_cabinet/"]
      yield* build(2)

      expect(heads((yield* records(["CAN"], 2016, 2016)).governments)).toEqual(["Trudeau J"])
    }).pipe(Effect.provide(serve(files)))
  })

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

  it.effect("skips every dataset whose records have not changed", () => {
    const run = steps()

    return Effect.gen(function* () {
      yield* build(1)
      // A week on, the archives hold the same records, fetched at another time.
      yield* TestClock.adjust("7 days")

      yield* PoliticsBuild.run(2).pipe(Effect.provide(run.layer))

      expect(run.ran().toSorted()).toEqual([
        "write Official elections",
        "write Official governments",
        "write PPEG elections",
        "write PPEG governments",
        "write ParlGov elections",
        "write ParlGov governments",
      ])
      expect(yield* published()).toEqual([
        { records: "elections", publisher: "Official", generation: 1 },
        { records: "elections", publisher: "PPEG", generation: 1 },
        { records: "elections", publisher: "ParlGov", generation: 1 },
        { records: "governments", publisher: "Official", generation: 1 },
        { records: "governments", publisher: "PPEG", generation: 1 },
        { records: "governments", publisher: "ParlGov", generation: 1 },
      ])
      expect(heads((yield* records(["CAN"], 2016, 2016)).governments)).toEqual(["Trudeau J"])
    }).pipe(Effect.provide(serve(recorded())))
  })

  it.effect("rebuilds only the dataset with a changed record", () => {
    const files = recorded()

    return Effect.gen(function* () {
      yield* build(1)
      files["https://parlgov.fly.dev/data-csv/data_cabinet/"] = () =>
        new Response(parlgovCabinets.replace("Trudeau J I,", "Trudeau Justin I,"))

      yield* build(2)

      expect(yield* published()).toEqual([
        { records: "elections", publisher: "Official", generation: 1 },
        { records: "elections", publisher: "PPEG", generation: 1 },
        { records: "elections", publisher: "ParlGov", generation: 1 },
        { records: "governments", publisher: "Official", generation: 1 },
        { records: "governments", publisher: "PPEG", generation: 1 },
        { records: "governments", publisher: "ParlGov", generation: 2 },
      ])
      expect(heads((yield* records(["CAN"], 2016, 2016)).governments)).toEqual(["Trudeau Justin"])
    }).pipe(Effect.provide(serve(files)))
  })

  it.effect("rebuilds every dataset over tables an earlier version made", () =>
    Effect.gen(function* () {
      yield* build(1).pipe(Effect.provide(politicsOver(recorded())))
      yield* dropFingerprints

      yield* build(2).pipe(Effect.provide(politicsOver(recorded())))

      expect(yield* published()).toEqual([
        { records: "elections", publisher: "Official", generation: 2 },
        { records: "elections", publisher: "PPEG", generation: 2 },
        { records: "elections", publisher: "ParlGov", generation: 2 },
        { records: "governments", publisher: "Official", generation: 2 },
        { records: "governments", publisher: "PPEG", generation: 2 },
        { records: "governments", publisher: "ParlGov", generation: 2 },
      ])
    }),
  )

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
