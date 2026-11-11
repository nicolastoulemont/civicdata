import { type CatalogEntry, IndicatorId } from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import { strToU8, zipSync } from "fflate"

import { Gather } from "../src/Gather.ts"
import { Sdmx } from "../src/Sdmx.ts"
import { Sources } from "../src/Sources.ts"
import { type SeriesBucket, Store } from "../src/Store.ts"
import { WorldBank } from "../src/WorldBank.ts"
import { build, catalogOver, entry, listings } from "./catalog.ts"
import { http, memory } from "./fakes.ts"
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
// release date, and the bulk download of each indicator code, or "broken"
// for an answer that is no ZIP. An unlisted code answers as the World Bank
// does for an indicator it does not know.
export interface Published {
  version: string
  answers: Map<string, Uint8Array<ArrayBuffer> | "broken">
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

    return new Response(found ?? unknown)
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
export const gatherOver = (client: ReturnType<typeof serving>["layer"], store: SeriesBucket) =>
  Gather.layer.pipe(
    Layer.provide(Store.r2(store)),
    Layer.provide(Sources.layer),
    Layer.provide(Layer.merge(WorldBank.layer, Sdmx.layer).pipe(Layer.provide(client))),
    Layer.provide(D1Client.layer({ db }).pipe(Layer.orDie)),
  )

// The sources charts read through: stored series first, the cached live
// query for the rest.
export const charts = (client: ReturnType<typeof serving>["layer"], store: SeriesBucket) =>
  Sources.stored.pipe(
    Layer.provide(Sources.layer),
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

// The release the last complete run gathered.
export const gathered = Effect.promise(() =>
  db.prepare("SELECT version FROM series_version WHERE scope = 'World Bank'").first("version"),
)
