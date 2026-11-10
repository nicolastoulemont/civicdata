import {
  Dimensions,
  type IndicatorId,
  IndicatorNotFound,
  type Observation,
  SourceUnavailable,
  Year,
} from "@civicdata/domain"
import {
  Array as Arr,
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Predicate,
  Schedule,
  Schema,
  Stream,
} from "effect"
import { HttpClient } from "effect/http"

import * as Csv from "./Csv.ts"
import { eurostat, parts } from "./Sdmx.ts"

// A dataset's last data update, as Eurostat's table of contents dates it,
// and how many values it holds across every frequency and region.
interface Release {
  readonly version: string
  readonly size: number
}

// One series of a dataset: the value of each dimension besides frequency and
// country, and its annual values for the countries we chart.
export interface Combination {
  readonly dimensions: Dimensions
  readonly observations: ReadonlyArray<Observation>
}

// Why a dataset is not stored: it has no annual values, none for a country
// we chart, more values than a gathering step can read, or Eurostat no
// longer publishes it.
export type Skip = "NoAnnual" | "NoCountries" | "TooLarge" | "NotFound"

// A dataset whose bulk file holds no series to store.
export class Unstorable extends Schema.TaggedError<Unstorable, { readonly brand: unique symbol }>()(
  "Unstorable",
  { reason: Schema.Literals(["NoAnnual", "NoCountries"]) },
) {}

// Eurostat publishes at 11:00 and 23:00 in Luxembourg.
const luxembourg = DateTime.zoneMakeNamedUnsafe("Europe/Luxembourg")

// Whether a release is dated before today in Luxembourg. One dated today may
// change again at 23:00 under the same date, since the table of contents
// dates releases by day.
export const isFinal = (version: string, now: DateTime.Utc) =>
  version < DateTime.formatIsoDate(DateTime.setZone(now, luxembourg))

interface Interface {
  // Every dataset's and table's release, by dataflow id, from the table of
  // contents: one request of about 2 MB for 7,600 datasets. It dates each
  // release by day only; the full dataflow list carries the hour too, but
  // weighs 20 MB.
  readonly releases: Effect.Effect<ReadonlyMap<string, Release>, SourceUnavailable>
  // A dataset's annual series for the countries we chart, one per
  // combination of its other dimensions, read from its bulk file as it
  // downloads. It fails with Unstorable once the file ends without one.
  readonly series: (
    indicator: IndicatorId,
  ) => Stream.Stream<Combination, IndicatorNotFound | SourceUnavailable | Unstorable>
}

const toc = `${eurostat}/catalogue/toc/txt?lang=en`

const unavailable = () => new SourceUnavailable({ source: "Eurostat" })

const unquote = (cell: string) => cell.replace(/^"|"$/g, "").trim()

// The table of contents: a quoted, tab-separated line per folder, dataset
// and table, a dataset or table listed once per folder that holds it. Its
// dates read "05.11.2026".
const releasesIn = (text: string) => {
  const found = new Map<string, Release>()

  for (const line of text.split(/\r?\n/)) {
    const [, code = "", type = "", updated = "", , , , values = ""] = line.split("\t").map(unquote)
    const date = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(updated)

    if ((type === "dataset" || type === "table") && date !== null) {
      found.set(code.toUpperCase(), {
        version: `${date[3]}-${date[2]}-${date[1]}`,
        size: Number(values) || 0,
      })
    }
  }

  return found
}

const isYear = Schema.is(Year)

const decodeDimensions = Schema.decodeUnknownOption(Dimensions)

// A bulk file's header: "freq,unit,geo\TIME_PERIOD", then one column per
// period, "1975 " or "2020-Q1 ". Only the years matter.
const columnsOf = (header: string) => {
  const [first = "", ...periods] = header.split("\t")
  const dimensions = (first.split("\\")[0] ?? "").split(",")

  return {
    dimensions,
    freq: dimensions.indexOf("freq"),
    geo: dimensions.indexOf("geo"),
    years: periods.map((period) => {
      const year = Number(period.trim())

      return /^\d{4}$/.test(period.trim()) && isYear(year) ? year : undefined
    }),
  }
}

type Columns = ReturnType<typeof columnsOf>

// One line of a bulk file: one series for one country. Its cells read
// "10873.1 p" (a value and its flags) or ": " (no value).
const rowOf = (line: string, columns: Columns) => {
  const [first = "", ...cells] = line.split("\t")
  const keys = first.split(",")
  const country = Csv.areas.Eurostat.country.get(keys[columns.geo] ?? "")
  const annual = columns.freq === -1 || keys[columns.freq] === "A"

  if (!annual || country === undefined) return { annual, row: undefined }

  const observations: Array<Observation> = []

  cells.forEach((cell, at) => {
    const year = columns.years[at]
    const [value = "", flags = ""] = cell.trim().split(" ")
    const number = value === ":" || value === "" ? Number.NaN : Number(value)

    if (year === undefined || !Number.isFinite(number)) return

    const found = Csv.flagsIn(flags, Csv.areas.Eurostat)

    observations.push(
      Arr.isArrayNonEmpty(found)
        ? { country, year, value: number, flags: found }
        : { country, year, value: number },
    )
  })

  const combination = keys.filter((_, at) => at !== columns.freq && at !== columns.geo)

  return { annual, row: { key: combination.join(","), combination, observations } }
}

// A bulk file's lines as series: the lines of one combination are adjacent,
// one per country, so each series is complete, and can be stored, once the
// next combination starts. The whole file is never held at once.
const parse = (lines: Stream.Stream<string, SourceUnavailable>, indicator: IndicatorId) =>
  Stream.suspend(() => {
    let annual = false
    let emitted = 0
    const done = new Set<string>()

    const series = lines.pipe(
      Stream.mapAccum(
        (): Columns | undefined => undefined,
        (columns, line) => {
          if (columns === undefined) return [columnsOf(line), []] as const

          if (line === "") return [columns, []] as const

          const read = rowOf(line, columns)

          annual ||= read.annual

          return [columns, read.row === undefined ? [] : [{ columns, ...read.row }]] as const
        },
      ),
      Stream.groupAdjacentBy((row) => row.key),
      Stream.mapEffect(([key, rows]) =>
        Effect.gen(function* () {
          const [{ columns, combination }] = rows

          if (done.has(key)) {
            yield* Effect.logWarning("Eurostat bulk file not grouped by series", indicator, key)

            return yield* unavailable()
          }

          done.add(key)

          const dimensions = decodeDimensions(
            Object.fromEntries(
              columns.dimensions
                .filter((_, at) => at !== columns.freq && at !== columns.geo)
                .map((id, at) => [id, combination[at]]),
            ),
          )

          if (Option.isNone(dimensions)) {
            yield* Effect.logWarning("Eurostat series codes not recognized", indicator, key)

            return undefined
          }

          const observations = rows.flatMap((row) => row.observations)

          if (!Arr.isArrayNonEmpty(observations)) return undefined

          emitted += 1

          return { dimensions: dimensions.value, observations } satisfies Combination
        }),
      ),
      Stream.filter(Predicate.isNotUndefined),
    )

    return Stream.concat(
      series,
      Stream.suspend(() =>
        emitted > 0
          ? Stream.empty
          : Stream.fail(new Unstorable({ reason: annual ? "NoCountries" : "NoAnnual" })),
      ),
    )
  })

// Eurostat's bulk download of a whole dataset, gzipped, every frequency and
// region in one tab-separated file. Eurostat builds it once per release and
// serves it at once, where the data API answers a large query only through
// an asynchronous job: national accounts' 938,000 annual country values come
// as 3.4 MB in under a second, against 64 MB after a 20-second job.
const bulkOf = (indicator: IndicatorId) =>
  `${eurostat}/sdmx/2.1/data/${parts(indicator).id}?format=TSV&compressed=true`

const make = Effect.gen(function* () {
  // A gathering run waits for it, not a visitor, so a request retries for
  // about 15 seconds.
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.retryTransient({ schedule: Schedule.exponential("1 second"), times: 4 }),
  )

  const releases = client
    .pipe(HttpClient.filterStatusOk)
    .get(toc)
    .pipe(
      Effect.flatMap((response) => response.text),
      Effect.timeout("1 minute"),
      Effect.map(releasesIn),
      Effect.tapError((error) => Effect.logWarning("Eurostat request failed", toc, error)),
      Effect.mapError(unavailable),
      Effect.withSpan("Eurostat.releases"),
    )

  const series = (indicator: IndicatorId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const url = bulkOf(indicator)

        const response = yield* client.get(url).pipe(
          Effect.tapError((error) => Effect.logWarning("Eurostat request failed", url, error)),
          Effect.mapError(unavailable),
        )

        if (response.status === 404) return yield* new IndicatorNotFound({ indicator })

        if (response.status !== 200) {
          yield* Effect.logWarning("Eurostat refused", url, response.status)

          return yield* unavailable()
        }

        // Copied into chunks of their own, as DecompressionStream takes them.
        const bytes = response.stream.pipe(
          Stream.map((chunk) => new Uint8Array(chunk)),
          Stream.tapError((error) => Effect.logWarning("Eurostat download failed", url, error)),
          Stream.mapError(unavailable),
        )

        const text = Stream.fromReadableStream({
          evaluate: () =>
            Stream.toReadableStream(bytes).pipeThrough(new DecompressionStream("gzip")),
          onError: unavailable,
        }).pipe(Stream.decodeText, Stream.splitLines)

        return parse(text, indicator)
      }),
    )

  return Eurostat.of({ releases, series })
})

// Eurostat's datasets as the gathering run reads them: release dates from
// the table of contents, and each dataset's series from its bulk file.
export class Eurostat extends Context.Service<Eurostat, Interface>()("@civicdata/server/Eurostat") {
  static readonly layer = Layer.effect(Eurostat, make)
}
