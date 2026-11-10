import { type CatalogEntry, IndicatorId } from "@civicdata/domain"
import { D1Client } from "@effect/sql-d1"
import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import { gzipSync, strToU8, zipSync } from "fflate"

import { Eurostat } from "../src/Eurostat.ts"
import { Gather } from "../src/Gather.ts"
import { Sdmx } from "../src/Sdmx.ts"
import { type SeriesBucket, Store } from "../src/Store.ts"
import { WorldBank } from "../src/WorldBank.ts"
import { build, catalogOver, emptyCatalog, entry, type Listings, listings } from "./catalog.ts"
import { http, memory } from "./fakes.ts"
import quarterly from "./fixtures/eurostat/bulk-ei_bpm6ca_q.tsv?raw"
import uneRtA from "./fixtures/eurostat/bulk-une_rt_a.tsv?raw"
import notPublished from "./fixtures/eurostat/bulk-unknown.xml?raw"
import unemploymentOptions from "./fixtures/eurostat/unemployment-options.csv?raw"
import unemploymentTotal from "./fixtures/eurostat/unemployment-total.csv?raw"
import population from "./fixtures/worldbank/bulk-population.csv?raw"
import unemployment from "./fixtures/worldbank/bulk-unemployment.csv?raw"
import unknown from "./fixtures/worldbank/bulk-unknown.xml?raw"
import sources from "./fixtures/worldbank/sources.json"

const db = env.DB
const series = env.SERIES

if (db === undefined || series === undefined) {
  throw new Error("vitest.config.ts must bind a D1 database as DB and an R2 bucket as SERIES")
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

// Eurostat's bulk files of unemployment by sex and age, trimmed to the 15 to
// 24 year olds in Germany, Greece, Spain, France and the EU, and of the
// current account, which is quarterly only.
export const eurostatRecorded = { unemployment: uneRtA, quarterly }

// One value cell of a bulk file, with its line's dimension values and
// country, such as ["A", "Y15-24", "PC_ACT", "F", "FR"].
interface Cell {
  readonly keys: ReadonlyArray<string>
  readonly year: number
  readonly cell: string
}

// A bulk file of the recording, each value cell replaced by what `change`
// answers for it (": " drops it), gzipped as Eurostat serves it.
export const file = (recording: string, change = ({ cell }: Cell) => cell) => {
  const [header = "", ...lines] = recording.split("\n")
  const years = header.split("\t").map((column) => Number(column.trim()))

  const edited = lines.map((line) => {
    if (line.trim() === "") return line

    const [first = "", ...cells] = line.replace(/\r$/, "").split("\t")
    const keys = first.split(",")

    return `${[first, ...cells.map((cell, at) => change({ keys, year: years[at + 1] ?? 0, cell }))].join("\t")}\r`
  })

  return gzipSync(strToU8([header, ...edited].join("\n")))
}

// Eurostat's table of contents listing each dataset with the date of its
// last update, such as "06.11.2026", and how many values it holds.
export const contents = (
  datasets: ReadonlyArray<{ id: IndicatorId; updated: string; values?: number }>,
) =>
  [
    '"title"\t"code"\t"type"\t"last update of data"\t"last table structure change"\t"data start"\t"data end"\t"values"',
    '"Database by themes"\t"data"\t"folder"\t" "\t" "\t" "\t" "\t',
    ...datasets.map(
      ({ id, updated, values = 38_655 }) =>
        `"    A dataset"\t"${(id.split(",")[1] ?? "").toLowerCase()}"\t"dataset"\t"${updated}"\t"${updated}"\t"2003"\t"2025"\t${values}`,
    ),
  ].join("\n")

// What the fake sources publish. The World Bank: the World Development
// Indicators' release date, and the bulk download of each indicator code, or
// "broken" for an answer that is no ZIP; an unlisted code answers as the
// World Bank does for an indicator it does not know. Eurostat: its table of
// contents, and the bulk file of each dataset by dataflow id, or "broken"
// for an answer that is no gzip; an unlisted id answers 404.
export interface Published {
  version: string
  answers: Map<string, Uint8Array<ArrayBuffer> | "broken">
  contents?: string
  files?: Map<string, Uint8Array<ArrayBuffer> | "broken">
}

// The sources over HTTP, counting the World Bank's requests, Eurostat's bulk
// downloads, and Eurostat's data queries, which charts send when no series
// is stored. Every Eurostat data query lists the dimensions of unemployment
// in France.
export const serving = (published: Published) => {
  let requests = 0
  let downloads = 0
  let queries = 0

  const eurostat = (url: URL) => {
    if (url.pathname.endsWith("/catalogue/toc/txt")) {
      return new Response(published.contents ?? contents([]))
    }

    if (url.pathname.includes("/sdmx/2.1/data/")) {
      downloads += 1

      const found = published.files?.get(url.pathname.split("/data/")[1] ?? "")

      if (found === "broken") return new Response("not gzip")

      return found === undefined ? new Response(notPublished, { status: 404 }) : new Response(found)
    }

    if (url.searchParams.has("lastNObservations")) return new Response(unemploymentOptions)

    queries += 1

    return new Response(unemploymentTotal)
  }

  const layer = http((address) => {
    const url = new URL(address)

    if (url.hostname === "ec.europa.eu") return eurostat(url)

    requests += 1

    const { pathname } = url

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

  return {
    layer,
    requests: () => requests,
    downloads: () => downloads,
    queries: () => queries,
  }
}

// The test Worker's SERIES bucket, counting the objects written to it, all
// of them or those under one source's folder, such as "eurostat".
export const bucket = () => {
  const written: Array<string> = []

  const counted: SeriesBucket = {
    get: (key) => series.get(key),
    head: (key) => series.head(key),
    put: (key, value, options) => {
      written.push(key)

      return series.put(key, value, options)
    },
    list: (options) => series.list(options),
  }

  return {
    bucket: counted,
    puts: (folder?: string) =>
      written.filter((key) => folder === undefined || key.startsWith(`series/v1/${folder}/`))
        .length,
  }
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

// The catalog tables and the gathering run's tables, empty.
export const emptyTables = async () => {
  await emptyCatalog()
  await db.exec(
    "DROP TABLE IF EXISTS series_version; DROP TABLE IF EXISTS series_held; DROP TABLE IF EXISTS series_release; DROP TABLE IF EXISTS series_skipped;",
  )
}

// The catalog listing `entries` for the World Bank, and `datasets` for
// Eurostat when a test gathers it, published.
export const catalogue = (
  entries: ReadonlyArray<CatalogEntry>,
  datasets?: ReadonlyArray<CatalogEntry>,
) =>
  Effect.suspend(() => {
    const lists: Partial<Listings> = { "World Bank": entries }

    if (datasets !== undefined) lists.Eurostat = datasets

    return build(1).pipe(Effect.provide(catalogOver(listings(lists))))
  })

// The gathering run over the test Worker's D1 database and SERIES bucket,
// asking the fake World Bank directly, as the deployed run does.
export const gatherOver = (client: ReturnType<typeof serving>["layer"], store: SeriesBucket) =>
  Gather.layer.pipe(
    Layer.provide(Store.r2(store)),
    Layer.provide(Layer.merge(WorldBank.layer, Eurostat.layer).pipe(Layer.provide(client))),
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

// The Eurostat adapter charts read through: stored series first, the cached
// live query for the rest.
export const eurostatCharts = (client: ReturnType<typeof serving>["layer"], store: SeriesBucket) =>
  Sdmx.stored.pipe(
    Layer.provide(Store.r2(store)),
    Layer.provide(client),
    Layer.provide(memory().layer),
  )

// The datasets a run skipped, and why.
export const skipped = () =>
  Effect.promise(() =>
    db.prepare("SELECT scope, reason FROM series_skipped ORDER BY scope").all(),
  ).pipe(Effect.map(({ results }) => results))

// The release a run last gathered of one Eurostat dataset.
export const gatheredOf = (scope: string) =>
  Effect.promise(() =>
    db.prepare("SELECT version FROM series_version WHERE scope = ?").bind(scope).first("version"),
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
