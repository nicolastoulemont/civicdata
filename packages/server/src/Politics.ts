import {
  Api,
  Ballot,
  Country,
  covers,
  Day,
  type Election,
  End,
  type Government,
  Party,
  Politics as PoliticalRecords,
  PoliticsUnavailable,
  Publisher,
  type Year,
  yearOf,
  yearsOf,
} from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
import { Array as Arr, Context, Effect, Layer, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { SqlClient, SqlSchema } from "effect/sql"

import events from "./official/events.json"
import reforms from "./official/reforms.json"

interface Query {
  readonly countries: ReadonlyArray<Country>
  readonly from: Year
  readonly to: Year
}

interface Interface {
  // The governments of the countries in office during any of the years,
  // their elections held in them, oldest first per country, and the events
  // and reforms of the years that concern any of them.
  readonly records: (query: Query) => Effect.Effect<PoliticalRecords, PoliticsUnavailable>
}

// The kinds of political records, each in its own table.
export const Records = Schema.Literals(["governments", "elections"])

// The political records' tables. `governments` and `elections` hold every
// generation of each publisher's records; `politics_current` names the
// generation of each publisher's records of each kind that reads use. A build
// writes a new generation and publishes it once complete (see
// PoliticsBuild.ts).
export const politicsTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    CREATE TABLE IF NOT EXISTS governments (
      publisher TEXT NOT NULL,
      generation INTEGER NOT NULL,
      country TEXT NOT NULL,
      start TEXT NOT NULL,
      head TEXT NOT NULL,
      parties TEXT NOT NULL,
      until TEXT,
      url TEXT NOT NULL,
      retrieved_at TEXT NOT NULL
    )
  `
  yield* sql`
    CREATE INDEX IF NOT EXISTS governments_country
    ON governments (country, publisher, generation)
  `
  yield* sql`
    CREATE TABLE IF NOT EXISTS elections (
      publisher TEXT NOT NULL,
      generation INTEGER NOT NULL,
      country TEXT NOT NULL,
      ballot TEXT NOT NULL,
      date TEXT NOT NULL,
      last_round TEXT,
      url TEXT NOT NULL,
      retrieved_at TEXT NOT NULL
    )
  `
  yield* sql`
    CREATE INDEX IF NOT EXISTS elections_country
    ON elections (country, publisher, generation)
  `
  yield* sql`
    CREATE TABLE IF NOT EXISTS politics_current (
      records TEXT NOT NULL,
      publisher TEXT NOT NULL,
      generation INTEGER NOT NULL,
      PRIMARY KEY (records, publisher)
    )
  `
})

const Row = Schema.Struct({
  publisher: Publisher,
  country: Country,
  start: Day,
  head: Schema.NonEmptyString,
  parties: Schema.fromJsonString(Schema.Array(Party)),
  until: Schema.NullOr(Day),
  url: Schema.NonEmptyString,
  retrieved_at: Schema.DateTimeUtcFromString,
})

type Row = typeof Row.Type

const ElectionRow = Schema.Struct({
  publisher: Publisher,
  country: Country,
  ballot: Ballot,
  date: Day,
  last_round: Schema.NullOr(Day),
  url: Schema.NonEmptyString,
  retrieved_at: Schema.DateTimeUtcFromString,
})

type ElectionRow = typeof ElectionRow.Type

const CountriesJson = Schema.fromJsonString(Schema.Array(Country))

// One country's elections from every publisher, oldest first, each once.
// Parliamentary elections follow the governments' rule: PPEG throughout its
// coverage, ParlGov before it. Presidential elections are PPEG's alone.
// Elections checked by hand come after both; one an archive already holds,
// for the same ballot and day, is not repeated.
const ballots = (rows: ReadonlyArray<ElectionRow>): ReadonlyArray<Election> => {
  const of = (publisher: Publisher) =>
    rows
      .filter((row) => row.publisher === publisher)
      .toSorted((a, b) => a.date.localeCompare(b.date))

  const ppeg = of("PPEG")
  const covered = ppeg.find((row) => row.ballot === "parliament")?.date

  const archived = [
    ...of("ParlGov").filter(
      (row) => row.ballot === "parliament" && (covered === undefined || row.date < covered),
    ),
    ...ppeg,
  ]

  const held = new Set(archived.map((row) => `${row.ballot} ${row.date}`))

  return [...archived, ...of("Official").filter((row) => !held.has(`${row.ballot} ${row.date}`))]
    .toSorted((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({
      country: row.country,
      ballot: row.ballot,
      date: row.date,
      lastRound: row.last_round,
      citation: { publisher: row.publisher, url: row.url, retrievedAt: row.retrieved_at },
    }))
}

const byStart = (a: Row, b: Row) => a.start.localeCompare(b.start)

// One country's governments from every publisher, in one sequence. PPEG
// counts throughout its coverage; ParlGov fills the years before it. Records
// checked by hand follow both, cutting the archives off where the first one
// starts. Each government ends when the next starts; the last ends at its
// publisher's cutoff if it was in office then, and is open otherwise.
const sequence = (rows: ReadonlyArray<Row>): ReadonlyArray<Government> => {
  const of = (publisher: Publisher) =>
    rows.filter((row) => row.publisher === publisher).toSorted(byStart)

  const ppeg = of("PPEG")
  const official = of("Official")
  const covered = ppeg[0]?.start
  const checked = official[0]?.start

  const archived = [
    ...of("ParlGov").filter((row) => covered === undefined || row.start < covered),
    ...ppeg,
  ].filter((row) => checked === undefined || row.start < checked)

  const all = [...archived, ...official]

  return all.map((row, index) => {
    const next = all[index + 1]

    return {
      country: row.country,
      head: row.head,
      parties: row.parties,
      start: row.start,
      end:
        next !== undefined
          ? End.cases.Next.make({ day: next.start })
          : row.until !== null
            ? End.cases.Cutoff.make({ day: row.until })
            : End.cases.Open.make({}),
      citation: { publisher: row.publisher, url: row.url, retrievedAt: row.retrieved_at },
    }
  })
}

// The last day a government is known in office: when the next started, when
// its publisher's records end, or, with no recorded end, its first day.
const lastDay = (government: Government) =>
  End.match(government.end, {
    Next: ({ day }) => day,
    Cutoff: ({ day }) => day,
    Open: () => government.start,
  })

// The governments and elections of every EU and OECD member, from the
// publishers' published generations, in sequence per country (see
// `sequence`), with the events and reforms checked by hand (see
// official/README.md).
export class Politics extends Context.Service<Politics, Interface>()("@civicdata/server/Politics") {
  static readonly layer = Layer.effect(
    Politics,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* politicsTables

      const history = yield* Schema.decodeUnknownEffect(PoliticalRecords.fields.events)(events)
      const reformed = yield* Schema.decodeUnknownEffect(PoliticalRecords.fields.reforms)(reforms)

      // The datasets published so far, of either kind.
      const published = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({ publisher: Publisher }),
        execute: () => sql`SELECT publisher FROM politics_current`,
      })

      const governments = SqlSchema.findAll({
        Request: Schema.Struct({ countries: CountriesJson }),
        Result: Row,
        execute: ({ countries }) => sql`
          SELECT governments.publisher, country, start, head, parties, until, url, retrieved_at
          FROM governments
          JOIN politics_current AS current
            ON current.records = 'governments'
            AND current.publisher = governments.publisher
            AND current.generation = governments.generation
          WHERE country IN (SELECT value FROM json_each(${countries}))
        `,
      })

      const elections = SqlSchema.findAll({
        Request: Schema.Struct({ countries: CountriesJson }),
        Result: ElectionRow,
        execute: ({ countries }) => sql`
          SELECT elections.publisher, country, ballot, date, last_round, url, retrieved_at
          FROM elections
          JOIN politics_current AS current
            ON current.records = 'elections'
            AND current.publisher = elections.publisher
            AND current.generation = elections.generation
          WHERE country IN (SELECT value FROM json_each(${countries}))
        `,
      })

      const records = Effect.fn("Politics.records")(
        function* ({ countries, from, to }: Query) {
          // Before the first build publishes anything, there is nothing to read.
          if (!Arr.isReadonlyArrayNonEmpty(yield* published())) {
            return yield* new PoliticsUnavailable()
          }

          const [governed, voted] = yield* Effect.all(
            [governments({ countries }), elections({ countries })],
            { concurrency: "unbounded" },
          )

          const first = `${from}-01-01`
          const last = `${to}-12-31`

          return {
            governments: countries.flatMap((country) =>
              sequence(governed.filter((row) => row.country === country)).filter(
                (government) => government.start <= last && lastDay(government) >= first,
              ),
            ),
            elections: countries.flatMap((country) =>
              ballots(voted.filter((row) => row.country === country)).filter(
                (election) =>
                  election.date <= last && (election.lastRound ?? election.date) >= first,
              ),
            ),
            events: history.filter((event) => {
              const years = yearsOf(event.when)

              return (
                countries.some((country) => covers(event.scope, country)) &&
                years.from <= to &&
                (years.to ?? to) >= from
              )
            }),
            reforms: reformed.filter(
              (reform) =>
                countries.includes(reform.country) &&
                yearOf(reform.date) >= from &&
                yearOf(reform.date) <= to,
            ),
          }
        },
        // Database and row-decoding failures are defects: nothing a caller can fix.
        Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die }),
      )

      return Politics.of({ records })
    }).pipe(Effect.orDie),
  )

  static readonly unavailable = Layer.succeed(
    Politics,
    Politics.of({ records: () => Effect.fail(new PoliticsUnavailable()) }),
  )

  // D1 inside Workers (deployed, or under `alchemy dev`). Plain `pnpm dev:web`
  // runs in Node, where `cloudflare:workers` does not exist.
  static readonly live = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) =>
        env.DB === undefined
          ? Politics.unavailable
          : Politics.layer.pipe(Layer.provide(D1Client.layer({ db: env.DB }).pipe(Layer.orDie))),
      ),
      Effect.orElseSucceed(() => Politics.unavailable),
    ),
  )
}

// The `politics` API routes. Defined beside the service rather than in
// Handlers.ts so their tests load no agent: with it, a test's modules no
// longer fit in one message to the workerd test runner.
export const PoliticsRoutes = HttpApiBuilder.group(
  Api,
  "politics",
  Effect.fn(function* (handlers) {
    const politics = yield* Politics

    return handlers.handle("records", ({ query }) => politics.records(query))
  }),
)
