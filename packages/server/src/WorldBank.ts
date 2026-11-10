import {
  type CatalogEntry,
  Country,
  IndicatorId,
  IndicatorNotFound,
  SourceUnavailable,
  Year,
} from "@civicdata/domain"
import { Context, DateTime, Duration, Effect, Layer, Schedule, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

import { Cache } from "./Cache.ts"
import { Pace } from "./Pace.ts"
import { Described, type Query, Series, widen } from "./Series.ts"
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

// `null` rows means the query matched nothing.
const ObservationsBody = Schema.Union([
  Message,
  Schema.Tuple([Schema.Struct({}), Schema.NullOr(Schema.Array(Row))]),
])

const unavailable = () => new SourceUnavailable({ source: "World Bank" })

// The World Development Indicators republish the estimate and score of the
// six Worldwide Governance Indicators under GOV_WGI_ codes. Their charts
// credit WGI, the dataset the World Bank asks users to cite for them.
const datasetOf = (indicator: IndicatorId, listed: string) =>
  indicator.startsWith("GOV_WGI_") ? "Worldwide Governance Indicators" : listed

const make = Effect.gen(function* () {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.filterStatusOk,
    HttpClient.retryTransient({ schedule: Schedule.exponential("250 millis"), times: 2 }),
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
    const years = query.to - query.from + 1
    // One page always holds every row: at most one per country and year.
    const url = `${base}/country/${query.countries.join(";")}/indicator/${query.indicator}?format=json&date=${query.from}:${query.to}&per_page=${query.countries.length * years}`
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

  return WorldBank.of({ describe, observations, indicators })
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
      })
    }),
  )

  static readonly live = WorldBank.cached.pipe(Layer.provide(Pace.http), Layer.provide(Cache.layer))
}
