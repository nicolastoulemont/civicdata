import {
  Api,
  Country,
  Day,
  End,
  type Government,
  Party,
  type Politics as Records,
  PoliticsUnavailable,
  Publisher,
  type Year,
} from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
import { Array as Arr, Context, Effect, Layer, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { SqlClient, SqlSchema } from "effect/sql"

interface Query {
  readonly countries: ReadonlyArray<Country>
  readonly from: Year
  readonly to: Year
}

interface Interface {
  // The governments of the countries in office during any of the years,
  // oldest first per country.
  readonly records: (query: Query) => Effect.Effect<Records, PoliticsUnavailable>
}

// The political records' tables. `governments` holds every generation of
// each publisher's records; `politics_current` names the generation of each
// publisher's records that reads use. A build writes a new generation and
// publishes it once complete (see PoliticsBuild.ts).
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

const CountriesJson = Schema.fromJsonString(Schema.Array(Country))

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

// The governments of every EU and OECD member, from the publishers'
// published generations, in sequence per country (see `sequence`).
export class Politics extends Context.Service<Politics, Interface>()("@civicdata/server/Politics") {
  static readonly layer = Layer.effect(
    Politics,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* politicsTables

      // The publishers whose governments have been published.
      const published = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({ publisher: Publisher }),
        execute: () => sql`SELECT publisher FROM politics_current WHERE records = 'governments'`,
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

      const records = Effect.fn("Politics.records")(
        function* ({ countries, from, to }: Query) {
          // Before the first build publishes anything, there is nothing to read.
          if (!Arr.isReadonlyArrayNonEmpty(yield* published())) {
            return yield* new PoliticsUnavailable()
          }

          const rows = yield* governments({ countries })
          const first = `${from}-01-01`
          const last = `${to}-12-31`

          return {
            governments: countries.flatMap((country) =>
              sequence(rows.filter((row) => row.country === country)).filter(
                (government) => government.start <= last && lastDay(government) >= first,
              ),
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
