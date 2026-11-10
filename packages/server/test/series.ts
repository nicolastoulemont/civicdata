import { type CatalogEntry, IndicatorId } from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
import { env } from "cloudflare:workers"
import { Effect, Layer, Schema } from "effect"

import { Gather } from "../src/Gather.ts"
import { type SeriesBucket, Store } from "../src/Store.ts"
import { WorldBank } from "../src/WorldBank.ts"
import { build, catalogOver, emptyCatalog, entry, listings } from "./catalog.ts"
import { http, memory } from "./fakes.ts"
import unknown from "./fixtures/worldbank/indicator-unknown.json"
import population from "./fixtures/worldbank/series-population.json"
import unemployment from "./fixtures/worldbank/series-unemployment.json"
import sources from "./fixtures/worldbank/sources.json"

const db = env.DB
const series = env.SERIES

if (db === undefined || series === undefined) {
  throw new Error("vitest.config.ts must bind a D1 database as DB and an R2 bucket as SERIES")
}

// A recorded World Bank answer, typed by the fields a test changes and kept
// whole otherwise.
const Answer = Schema.Tuple([
  Schema.Record(Schema.String, Schema.Unknown),
  Schema.Array(
    Schema.StructWithRest(
      Schema.Struct({
        countryiso3code: Schema.String,
        date: Schema.String,
        value: Schema.NullOr(Schema.Number),
      }),
      [Schema.Record(Schema.String, Schema.Unknown)],
    ),
  ),
])

type Answer = typeof Answer.Type

type Row = Answer[1][number]

// The recorded World Bank answers for every country and year of an indicator,
// trimmed to Germany, Spain and France since 2020.
export const recorded = {
  population: Schema.decodeUnknownSync(Answer)(population),
  unemployment: Schema.decodeUnknownSync(Answer)(unemployment),
}

// An answer with only the rows `keep` keeps, after `change`.
export const answer = (
  recording: Answer,
  {
    keep = () => true,
    change = (row) => row,
  }: { keep?: (row: Row) => boolean; change?: (row: Row) => Row } = {},
) => {
  const [head, rows] = recording
  const kept = rows.filter(keep).map(change)

  return [{ ...head, total: kept.length }, kept]
}

// What the fake World Bank publishes: the World Development Indicators'
// release date, and the answer for each indicator code, or "broken" for an
// answer in a shape the adapter does not recognize. An unlisted code answers
// as the World Bank does for an indicator it does not know.
export interface Published {
  version: string
  answers: Map<string, unknown>
}

// The World Bank over HTTP, counting the requests it answers.
export const serving = (published: Published) => {
  let requests = 0

  const layer = http((url) => {
    requests += 1

    const { pathname } = new URL(url)

    // The recorded answer, dated with the release the test publishes.
    if (pathname === "/v2/sources/2") {
      return new Response(
        JSON.stringify(sources).replace(
          /"lastupdated":"[^"]*"/,
          `"lastupdated":"${published.version}"`,
        ),
      )
    }

    const found = published.answers.get(pathname.split("/indicator/")[1] ?? "")

    if (found === "broken") return Response.json({ unexpected: true })

    return Response.json(found ?? unknown)
  })

  return { layer, requests: () => requests }
}

// The test Worker's SERIES bucket, counting the objects written to it.
export const bucket = () => {
  let puts = 0

  const counted: SeriesBucket = {
    get: (key) => series.get(key),
    head: (key) => series.head(key),
    put: (key, value, options) => {
      puts += 1

      return series.put(key, value, options)
    },
  }

  return { bucket: counted, puts: () => puts }
}

// Each test names its own indicators, such as `HOLD.POP`, so the series one
// test stores never meet another's in the shared bucket.
export const indicators = (prefix: string) => ({
  population: IndicatorId.make(`${prefix}.POP`),
  unemployment: IndicatorId.make(`${prefix}.UEM`),
})

export const catalogOf = (codes: ReturnType<typeof indicators>): ReadonlyArray<CatalogEntry> => [
  entry(codes.population, "Population, total", "Total population."),
  entry(codes.unemployment, "Unemployment, total (% of total labor force)"),
]

// The World Bank publishing the recorded answers for both indicators.
export const publishing = (codes: ReturnType<typeof indicators>): Published => ({
  version: "2026-10-08",
  answers: new Map<string, unknown>([
    [codes.population, answer(recorded.population)],
    [codes.unemployment, answer(recorded.unemployment)],
  ]),
})

// The catalog tables and the gathering run's tables, empty.
export const emptyTables = async () => {
  await emptyCatalog()
  await db.exec("DROP TABLE IF EXISTS series_version; DROP TABLE IF EXISTS series_held;")
}

// The catalog listing `entries`, published.
export const catalogue = (entries: ReadonlyArray<CatalogEntry>) =>
  build(1).pipe(Effect.provide(catalogOver(listings({ "World Bank": entries }))))

// The gathering run over the test Worker's D1 database and SERIES bucket,
// asking the fake World Bank directly, as the deployed run does.
export const gatherOver = (client: ReturnType<typeof serving>["layer"], store: SeriesBucket) =>
  Gather.layer.pipe(
    Layer.provide(Store.r2(store)),
    Layer.provide(WorldBank.layer.pipe(Layer.provide(client))),
    Layer.provide(D1Client.layer({ db }).pipe(Layer.orDie)),
  )

// The World Bank adapter charts read through: stored series first, the
// cached live query for the rest.
export const charts = (client: ReturnType<typeof serving>["layer"], store: SeriesBucket) =>
  WorldBank.stored.pipe(
    Layer.provide(Store.r2(store)),
    Layer.provide(client),
    Layer.provide(memory().layer),
  )

// The held-back candidates the run recorded.
export const held = () =>
  Effect.promise(() => db.prepare("SELECT series, reason, lost FROM series_held").all()).pipe(
    Effect.map(({ results }) => results),
  )

// The release the last complete run gathered.
export const gathered = Effect.promise(() =>
  db.prepare("SELECT version FROM series_version WHERE scope = 'World Bank'").first("version"),
)
