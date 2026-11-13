import { D1Client } from "@effect/sql-d1"
import { type CatalogEntry, IndicatorId } from "@repo/domain"
import { env } from "cloudflare:workers"
import { type Duration, Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { strToU8, zipSync } from "fflate"

import { Faostat, type FaostatArchive } from "../src/Faostat.ts"
import { Gather } from "../src/Gather.ts"
import { Ilostat } from "../src/Ilostat.ts"
import { Imf } from "../src/Imf.ts"
import { Insee } from "../src/Insee.ts"
import { Sdmx } from "../src/Sdmx.ts"
import { Sources } from "../src/Sources.ts"
import { type SeriesBucket, Store } from "../src/Store.ts"
import { Vdem } from "../src/Vdem.ts"
import { Who } from "../src/Who.ts"
import { Wid } from "../src/Wid.ts"
import { WorldBank } from "../src/WorldBank.ts"
import { build, catalogOver, entry, listings } from "./catalog.ts"
import { memory, offline } from "./fakes.ts"
import population from "./fixtures/worldbank/bulk-population.csv?raw"
import unemployment from "./fixtures/worldbank/bulk-unemployment.csv?raw"
import unknown from "./fixtures/worldbank/bulk-unknown.xml?raw"
import sources from "./fixtures/worldbank/sources.json"

const db = env.CATALOG_DB
const series = env.SERIES

if (db === undefined || series === undefined) {
  throw new Error(
    "vitest.config.ts must bind a D1 database as CATALOG_DB and an R2 bucket as SERIES",
  )
}

// The World Bank's bulk downloads of population and unemployment, trimmed to
// Germany, Spain, France and the European Union.
export const recorded = { population, unemployment }

// One value cell of a bulk download's CSV, as a test may change it.
interface Value {
  readonly country: string
  readonly year: number
  readonly cell: string
}

// Every field of the CSV is quoted, and each line ends with a comma.
const fieldsOf = (line: string) => line.replace(/,\r?$/, "").slice(1, -1).split('","')

const lineOf = (fields: ReadonlyArray<string>) =>
  `${fields.map((field) => `"${field}"`).join(",")},\r`

// A bulk download of the recording, each value cell replaced by what
// `change` answers for it ("" drops it), zipped beside a metadata file as
// the World Bank ships it.
export const bulk = (recording: string, change = ({ cell }: Value) => cell) => {
  const lines = recording.split("\n")
  const header = lines.findIndex((line) => line.startsWith('"Country Name"'))
  const columns = fieldsOf(lines[header] ?? "")

  const edited = lines.map((line, at) => {
    if (at <= header || line.trim() === "") return line

    const fields = fieldsOf(line)
    const country = fields[1] ?? ""

    return lineOf(
      fields.map((cell, column) => {
        const year = Number(columns[column])

        return column < 4 || !Number.isInteger(year) ? cell : change({ country, year, cell })
      }),
    )
  })

  return zipSync({
    "API_SP.POP.TOTL_DS2_en_csv_v2_1.csv": strToU8(edited.join("\n")),
    "Metadata_Indicator_API_SP.POP.TOTL_DS2_en_csv_v2_1.csv": strToU8('"INDICATOR_CODE",\r\n'),
  })
}

// What the fake World Bank publishes: the World Development Indicators'
// release date, and the bulk download of each indicator code, "broken" for
// an answer that is no ZIP, a status it fails with, or "hang" for a request
// it never answers. An unlisted code answers as the World Bank does for an
// indicator it does not know.
export interface Published {
  version: string
  answers: Map<string, Uint8Array<ArrayBuffer> | "broken" | "hang" | { status: number }>
}

// The World Bank over HTTP, counting the requests it answers. Each bulk
// download takes `delay` of the test clock.
export const serving = (published: Published, { delay }: { delay?: Duration.Input } = {}) => {
  let requests = 0

  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.gen(function* () {
        requests += 1

        const { pathname } = new URL(request.url)
        const answer = (response: Response) => HttpClientResponse.fromWeb(request, response)

        // The recorded answer, dated with the release the test publishes.
        if (pathname === "/v2/sources/2") {
          return answer(
            new Response(
              JSON.stringify(sources).replace(
                /"lastupdated":"[^"]*"/,
                `"lastupdated":"${published.version}"`,
              ),
            ),
          )
        }

        if (delay !== undefined) yield* TestClock.adjust(delay)

        const found = published.answers.get(pathname.split("/indicator/")[1] ?? "")

        if (found === "hang") return yield* Effect.never

        if (found === "broken") return answer(Response.json({ unexpected: true }))

        if (found !== undefined && "status" in found)
          return answer(new Response("<title>5xx Error Page</title>", { status: found.status }))

        return answer(new Response(found ?? unknown))
      }),
    ),
  )

  return { layer, requests: () => requests }
}

// The test Worker's SERIES bucket, counting the objects read from it and
// written to it.
export const bucket = () => {
  let [gets, puts] = [0, 0]

  const counted: SeriesBucket = {
    get: (key) => {
      gets += 1

      return series.get(key)
    },
    put: (key, value, options) => {
      puts += 1

      return series.put(key, value, options)
    },
    delete: (keys) => series.delete(keys),
  }

  return { bucket: counted, gets: () => gets, puts: () => puts }
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
  answers: new Map([
    [codes.population, bulk(recorded.population)],
    [codes.unemployment, bulk(recorded.unemployment)],
  ]),
})

// The catalog listing `entries`, published.
export const catalogue = (entries: ReadonlyArray<CatalogEntry>) =>
  build(1).pipe(Effect.provide(catalogOver(listings({ "World Bank": entries }))))

// The gathering run over the test Worker's D1 database and SERIES bucket,
// asking the fake World Bank directly, as the deployed run does.
// With `faostat`, FAOSTAT is a mirror too, gathered after the World Bank.
export const gatherOver = (
  client: ReturnType<typeof serving>["layer"],
  store: SeriesBucket,
  { faostat }: { faostat?: Layer.Layer<FaostatArchive | HttpClient.HttpClient> } = {},
) =>
  Gather.layer.pipe(
    Layer.provide(Store.r2(store)),
    Layer.provide(Sources.layer),
    Layer.provide(Insee.layer.pipe(Layer.provide(offline))),
    Layer.provide(Ilostat.layer.pipe(Layer.provide(offline))),
    Layer.provide(Vdem.layer),
    Layer.provide(Wid.layer),
    Layer.provide(Imf.layer),
    Layer.provide(Who.layer.pipe(Layer.provide(offline))),
    Layer.provide(Faostat.layer.pipe(Layer.provide(faostat ?? offline))),
    Layer.provide(Layer.merge(WorldBank.layer, Sdmx.layer).pipe(Layer.provide(client))),
    Layer.provide(D1Client.layer({ db }).pipe(Layer.orDie)),
  )

// The sources charts read through: stored series first, the cached live
// query for the rest.
export const charts = (client: ReturnType<typeof serving>["layer"], store: SeriesBucket) =>
  Sources.stored.pipe(
    Layer.provide(Sources.layer),
    Layer.provide(Insee.layer.pipe(Layer.provide(offline))),
    Layer.provide(Ilostat.layer.pipe(Layer.provide(offline))),
    Layer.provide(Vdem.layer),
    Layer.provide(Wid.layer),
    Layer.provide(Imf.layer),
    Layer.provide(Who.layer.pipe(Layer.provide(offline))),
    Layer.provide(Faostat.layer.pipe(Layer.provide(offline))),
    Layer.provide(Store.r2(store)),
    Layer.provide(Layer.merge(WorldBank.cached, Sdmx.cached)),
    Layer.provide(client),
    Layer.provide(memory().layer),
  )

// The held-back candidates the run recorded.
export const held = () =>
  Effect.promise(() => db.prepare("SELECT series, reason, lost FROM series_held").all()).pipe(
    Effect.map(({ results }) => results),
  )

// A stored entry's release, or null when no entry was recorded yet.
export const gathered = Effect.promise(() =>
  db
    .prepare(
      "SELECT json_extract(state, '$.version') FROM asset_gathered WHERE json_extract(state, '$._tag') = 'Stored' LIMIT 1",
    )
    .first("json_extract(state, '$.version')"),
)

export const ledgerRows = () =>
  db
    .prepare("SELECT scope, asset AS indicator, state FROM asset_gathered ORDER BY asset")
    .all<{ scope: string; indicator: string; state: string }>()

export const seriesDb = db
