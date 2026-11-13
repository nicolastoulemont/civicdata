import { D1Client } from "@effect/sql-d1"
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
  PartyColor,
  Politics as PoliticalRecords,
  PoliticsUnavailable,
  Publisher,
  type Year,
  yearOf,
  yearsOf,
} from "@repo/domain"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { SqlClient, SqlSchema } from "effect/sql"

import { orUnbuilt } from "../platform/built.ts"
import events from "./assets/official/events.json"
import reforms from "./assets/official/reforms.json"
import colors from "./assets/parties/colors.json"
import { datasets } from "./constants/datasets.ts"
import { Dataset } from "./Politics.schemas.ts"

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

// The political records' tables. `governments` and `elections` hold every
// generation of each publisher's records; `politics_current` names the
// generation of each publisher's records of each kind that reads use;
// `politics_fingerprint` holds a fingerprint of what each generation stores,
// which tells a build whether the records changed since the published
// generation. A build writes a new generation and publishes it once complete
// (see PoliticsBuild.ts). Only builds run this: readers never create tables
// (built.ts).
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
  // A table of its own, rather than a column of politics_current, so a stage
  // whose tables an earlier version made gets it too.
  yield* sql`
    CREATE TABLE IF NOT EXISTS politics_fingerprint (
      records TEXT NOT NULL,
      publisher TEXT NOT NULL,
      generation INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      PRIMARY KEY (records, publisher, generation)
    )
  `
})

// A governing party as a build stored it. Builds before party ids were kept
// stored neither the id nor the head's party; such a party reads as having
// neither until the next build replaces it.
const StoredParty = Schema.Struct({
  ...Party.fields,
  id: Schema.NullOr(Schema.NonEmptyString).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  lead: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
})

type StoredParty = typeof StoredParty.Type

const Row = Schema.Struct({
  publisher: Publisher,
  country: Country,
  start: Day,
  head: Schema.NonEmptyString,
  parties: Schema.fromJsonString(Schema.Array(StoredParty)),
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

// A party's colour as parties/colors.json lists it, under its publisher's id
// for the party (see parties/README.md).
const Colored = Schema.Struct({
  country: Country,
  publisher: Schema.Literals(["PPEG", "ParlGov"]),
  party: Schema.NonEmptyString,
  ...PartyColor.fields,
})

const keyOf = ({ publisher, party }: { publisher: Publisher; party: string }) =>
  `${publisher} ${party}`

const Palette = Schema.Struct({
  colors: Schema.Array(Colored).check(
    Schema.makeFilter(
      (all) =>
        new Set(all.map(keyOf)).size === all.length || "one colour per publisher and party id",
    ),
  ),
})

type Colors = ReadonlyMap<string, typeof Colored.Type>

// The colour of a government's head's party: only when its publisher names
// exactly one party as the head's, and that party has a colour under the
// publisher's own id for it in the same country. Never by a party's name.
const colorOf = (palette: Colors, row: Row): PartyColor | null => {
  const leads = row.parties.filter((party) => party.lead)
  const [lead] = leads

  if (leads.length !== 1 || lead?.id == null) return null

  const found = palette.get(keyOf({ publisher: row.publisher, party: lead.id }))

  return found === undefined || found.country !== row.country
    ? null
    : { hex: found.hex, kind: found.kind, url: found.url }
}

// A party as the API names it, without its publisher's id.
const named = ({ name, abbreviation }: StoredParty): Party => ({ name, abbreviation })

// One country's governments from every publisher, in one sequence. PPEG
// counts throughout its coverage; ParlGov fills the years before it. Records
// checked by hand follow both, cutting the archives off where the first one
// starts. Each government ends when the next starts; the last ends at its
// publisher's cutoff if it was in office then, and is open otherwise.
const sequence = (rows: ReadonlyArray<Row>, palette: Colors): ReadonlyArray<Government> => {
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
      parties: row.parties.map(named),
      color: colorOf(palette, row),
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
export class Politics extends Context.Service<Politics, Interface>()("@repo/server/Politics") {
  static readonly layer = Layer.effect(
    Politics,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const history = yield* Schema.decodeUnknownEffect(PoliticalRecords.fields.events)(events)
      const reformed = yield* Schema.decodeUnknownEffect(PoliticalRecords.fields.reforms)(reforms)

      const palette: Colors = new Map(
        (yield* Schema.decodeUnknownEffect(Palette)(colors)).colors.map((color) => [
          keyOf(color),
          color,
        ]),
      )

      // The datasets published so far.
      const published = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Dataset,
        execute: () => sql`SELECT records, publisher FROM politics_current`,
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
          // Every answer reads each publisher's records of both kinds, so
          // until a build has published them all, a country's records are
          // unknown rather than none. A database no build has written to
          // has published nothing.
          const stored = yield* published().pipe(
            orUnbuilt({ sql, tables: ["governments", "elections", "politics_current"], value: [] }),
          )

          if (
            !datasets.every((dataset) =>
              stored.some(
                (found) =>
                  found.records === dataset.records && found.publisher === dataset.publisher,
              ),
            )
          ) {
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
              sequence(
                governed.filter((row) => row.country === country),
                palette,
              ).filter((government) => government.start <= last && lastDay(government) >= first),
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

  // The catalog's D1 inside Workers (deployed, or under `alchemy dev`). Plain
  // `pnpm dev:web` runs in Node, where `cloudflare:workers` does not exist.
  static readonly live = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) =>
        env.CATALOG_DB === undefined
          ? Politics.unavailable
          : Politics.layer.pipe(
              Layer.provide(D1Client.layer({ db: env.CATALOG_DB }).pipe(Layer.orDie)),
            ),
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
