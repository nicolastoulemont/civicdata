import {
  type CatalogEntry,
  Country,
  IndicatorId,
  IndicatorNotFound,
  SourceUnavailable,
  Year,
} from "@civicdata/domain"
import { Context, DateTime, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { unzipSync } from "fflate"

import { Cache } from "./Cache.ts"
import { records } from "./Csv.ts"
import { Pace } from "./Pace.ts"
import { Described, type Query, Series, widen } from "./Series.ts"
import { Store } from "./Store.ts"
import { plain } from "./text.ts"

const base = "https://api.worldbank.org/v2"

interface Interface {
  readonly describe: (
    indicator: IndicatorId,
  ) => Effect.Effect<Described, IndicatorNotFound | SourceUnavailable>
  readonly observations: (
    query: Query,
  ) => Effect.Effect<Series, IndicatorNotFound | SourceUnavailable>
  // Every World Development Indicators indicator, in one request.
  readonly indicators: Effect.Effect<ReadonlyArray<CatalogEntry>, SourceUnavailable>
  // The day the World Development Indicators last changed, such as
  // "2026-10-08". The World Bank publishes one for the whole dataset.
  readonly version: Effect.Effect<string, SourceUnavailable>
  // Every value of the indicator in every country we chart, from its bulk
  // download.
  readonly series: (
    indicator: IndicatorId,
  ) => Effect.Effect<Series, IndicatorNotFound | SourceUnavailable>
}

// The World Bank reports request errors with HTTP 200 and this body.
// Message "120" ("Invalid value") is what an unknown indicator returns.
const Message = Schema.Tuple([
  Schema.Struct({ message: Schema.NonEmptyArray(Schema.Struct({ id: Schema.String })) }),
])

const Metadata = Schema.Struct({
  id: IndicatorId,
  name: Schema.NonEmptyString,
  sourceNote: Schema.String,
  source: Schema.Struct({ value: Schema.NonEmptyString }),
})

const Row = Schema.Struct({
  countryiso3code: Country,
  date: Schema.FiniteFromString.pipe(Schema.decodeTo(Year)),
  value: Schema.NullOr(Schema.Finite),
})

const DescribeBody = Schema.Union([
  Message,
  Schema.Tuple([Schema.Struct({}), Schema.Tuple([Metadata])]),
])

// Asked with a page size above the ~1,500 indicators, so one page holds them all.
const IndicatorsBody = Schema.Tuple([Schema.Struct({}), Schema.Array(Metadata)])

const VersionBody = Schema.Tuple([
  Schema.Struct({}),
  Schema.Tuple([Schema.Struct({ lastupdated: Schema.NonEmptyString })]),
])

// `null` rows means the query matched nothing.
const ObservationsBody = Schema.Union([
  Message,
  Schema.Tuple([Schema.Struct({}), Schema.NullOr(Schema.Array(Row))]),
])

const unavailable = () => new SourceUnavailable({ source: "World Bank" })

// The request that answers the query's values. One page always holds every
// row: at most one per country and year.
const urlOf = (query: Query) =>
  `${base}/country/${query.countries.join(";")}/indicator/${query.indicator}?format=json&date=${query.from}:${query.to}&per_page=${query.countries.length * (query.to - query.from + 1)}`

// The bulk download of one indicator: a ZIP of three CSV files, the values in
// the one named API_<indicator>_..., one row per economy and one column per
// year since 1960. It is a static file, served in a tenth of a second, where
// the API takes from a second to several minutes to list every country and
// year of an indicator it has not answered lately.
const bulkOf = (indicator: IndicatorId) => `${base}/en/indicator/${indicator}?downloadformat=csv`

const isCountry = Schema.is(Country)

const isYear = Schema.is(Year)

// The values of a bulk download's CSV, for the countries we chart: its
// regions and income groups are left out. The lines before its header name
// the dataset and its last update.
const valuesOf = (header: string) =>
  records(header).flatMap((row) => {
    const country = row.get("Country Code")

    if (!isCountry(country)) return []

    return [...row].flatMap(([column, cell]) => {
      const [year, value] = [Number(column), Number(cell)]

      return isYear(year) && cell !== "" && Number.isFinite(value) ? [{ country, year, value }] : []
    })
  })

// The World Development Indicators republish the estimate and score of the
// six Worldwide Governance Indicators under GOV_WGI_ codes. Their charts
// credit WGI, the dataset the World Bank asks users to cite for them.
export const datasetOf = (indicator: IndicatorId, listed: string) =>
  indicator.startsWith("GOV_WGI_") ? "Worldwide Governance Indicators" : listed

const make = Effect.gen(function* () {
  const ok = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

  const client = ok.pipe(
    HttpClient.retryTransient({ schedule: Schedule.exponential("250 millis"), times: 2 }),
  )

  // A gathering run waits for it, not a visitor, so a bulk download retries
  // for about 15 seconds: one failure leaves the release unrecorded, and the
  // next run asks for every indicator again.
  const patient = ok.pipe(
    HttpClient.retryTransient({ schedule: Schedule.exponential("1 second"), times: 4 }),
  )

  // Fetches a World Bank URL and decodes its body. Every transport, status
  // and shape failure becomes SourceUnavailable; the cause is logged, not
  // sent to clients.
  const fetch = <A, I>(url: string, body: Schema.Codec<A, I>) =>
    client.get(url).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(body)),
      Effect.timeout("15 seconds"),
      Effect.tapError((error) => Effect.logWarning("World Bank request failed", url, error)),
      Effect.mapError(unavailable),
    )

  const describe = Effect.fn("WorldBank.describe")(function* (indicator: IndicatorId) {
    const url = `${base}/indicator/${indicator}?format=json`

    const [, rows] = yield* fetch(url, DescribeBody).pipe(
      Effect.filterOrFail(
        (decoded) => decoded.length === 2,
        () => new IndicatorNotFound({ indicator }),
      ),
    )

    const [metadata] = rows

    return {
      indicator: { id: metadata.id, name: metadata.name, definition: plain(metadata.sourceNote) },
      dataset: datasetOf(metadata.id, metadata.source.value),
      retrievedAt: yield* DateTime.now,
    }
  })

  const observations = Effect.fn("WorldBank.observations")(function* (query: Query) {
    const url = urlOf(query)
    const decoded = yield* fetch(url, ObservationsBody)

    if (decoded.length === 1) {
      return yield* new IndicatorNotFound({ indicator: query.indicator })
    }

    const rows = decoded[1] ?? []

    return {
      observations: rows.flatMap((row) =>
        row.value === null
          ? []
          : [{ country: row.countryiso3code, year: row.date, value: row.value }],
      ),
      url,
      retrievedAt: yield* DateTime.now,
    }
  })

  const indicators = fetch(
    `${base}/indicator?format=json&source=2&per_page=20000`,
    IndicatorsBody,
  ).pipe(
    Effect.map(([, rows]) =>
      rows.map((row) => ({ indicator: row.id, name: row.name, definition: plain(row.sourceNote) })),
    ),
    Effect.withSpan("WorldBank.indicators"),
  )

  const series = Effect.fn("WorldBank.series")(function* (indicator: IndicatorId) {
    const url = bulkOf(indicator)

    const buffer = yield* patient.get(url).pipe(
      Effect.flatMap((response) => response.arrayBuffer),
      Effect.timeout("1 minute"),
      Effect.tapError((error) => Effect.logWarning("World Bank request failed", url, error)),
      Effect.mapError(unavailable),
    )

    // An indicator the World Bank does not know answers an XML error, which
    // is no ZIP.
    const files = yield* Effect.try({
      try: () =>
        unzipSync(new Uint8Array(buffer), { filter: ({ name }) => name.startsWith("API_") }),
      catch: () =>
        new TextDecoder().decode(buffer).includes('id="120"')
          ? new IndicatorNotFound({ indicator })
          : unavailable(),
    })

    const [csv] = Object.values(files)
    const text = csv === undefined ? "" : new TextDecoder().decode(csv)
    const header = text.indexOf('"Country Name"')

    if (header === -1) {
      yield* Effect.logWarning("World Bank bulk download holds no values", url)

      return yield* unavailable()
    }

    return { observations: valuesOf(text.slice(header)), url, retrievedAt: yield* DateTime.now }
  })

  const version = fetch(`${base}/sources/2?format=json`, VersionBody).pipe(
    Effect.map(([, [source]]) => source.lastupdated),
    Effect.withSpan("WorldBank.version"),
  )

  return WorldBank.of({ describe, observations, indicators, version, series })
})

// World Bank indicators change a few times a year at most.
const lifetime = Duration.days(1)

const fresh = (retrievedAt: DateTime.Utc, now: DateTime.Utc) =>
  Duration.isLessThan(DateTime.distance(retrievedAt, now), lifetime)

const DescribedJson = Schema.fromJsonString(Schema.toCodecJson(Described))
const SeriesJson = Schema.fromJsonString(Schema.toCodecJson(Series))

// Bump a key's version when what it caches changes, so old entries are
// ignored.
const keys = {
  described: (indicator: IndicatorId) => `worldbank/v3/indicator/${indicator}`,
  series: (query: Query) =>
    `worldbank/v1/series/${query.indicator}/${query.countries.toSorted().join(",")}/${query.from}-${query.to}`,
}

export class WorldBank extends Context.Service<WorldBank, Interface>()(
  "@civicdata/server/WorldBank",
) {
  static readonly layer = Layer.effect(WorldBank, make)

  // Serves a stored result younger than `lifetime`, otherwise asks the World
  // Bank and stores the answer. Asks for the recent years at once (`widen`).
  static readonly cached = Layer.effect(
    WorldBank,
    Effect.gen(function* () {
      const live = yield* make
      const remember = yield* Cache.remember

      return WorldBank.of({
        describe: (indicator) =>
          remember(keys.described(indicator), {
            json: DescribedJson,
            fresh,
            fetch: live.describe(indicator),
          }),
        observations: widen((query) =>
          remember(keys.series(query), {
            json: SeriesJson,
            fresh,
            fetch: live.observations(query),
          }),
        ),
        // The catalog keeps its own copy in D1.
        indicators: live.indicators,
        version: live.version,
        series: live.series,
      })
    }),
  )

  // Answers an indicator's description and values from its stored series,
  // filtered to the query, without asking the World Bank. The answer links
  // the World Bank request that returns the same values and reports when the
  // stored series was fetched. An indicator with no stored series, or a
  // store that fails, is asked of the adapter it wraps.
  static readonly stored = Layer.effect(
    WorldBank,
    Effect.gen(function* () {
      const fallback = yield* WorldBank
      const store = yield* Store

      const read = (indicator: IndicatorId) =>
        store
          .read({ indicator })
          .pipe(
            Effect.catchTag("StoreUnavailable", (error) =>
              Effect.logWarning("Store unavailable, asking the World Bank", indicator, error).pipe(
                Effect.as(Option.none()),
              ),
            ),
          )

      return WorldBank.of({
        describe: Effect.fn("WorldBank.stored.describe")(function* (indicator) {
          const stored = yield* read(indicator)

          if (Option.isNone(stored)) return yield* fallback.describe(indicator)

          const { dataset, retrievedAt } = stored.value

          return { indicator: stored.value.indicator, dataset, retrievedAt }
        }),
        observations: Effect.fn("WorldBank.stored.observations")(function* (query) {
          const stored = yield* read(query.indicator)

          if (Option.isNone(stored)) return yield* fallback.observations(query)

          const countries = new Set(query.countries)

          return {
            observations: stored.value.observations.filter(
              ({ country, year }) =>
                countries.has(country) && year >= query.from && year <= query.to,
            ),
            url: urlOf(query),
            retrievedAt: stored.value.retrievedAt,
          }
        }),
        indicators: fallback.indicators,
        version: fallback.version,
        series: fallback.series,
      })
    }),
  ).pipe(Layer.provide(WorldBank.cached))

  static readonly live = WorldBank.stored.pipe(
    Layer.provide(Store.layer),
    Layer.provide(Pace.http),
    Layer.provide(Cache.layer),
  )
}
