import {
  type CatalogEntry,
  Country,
  Indicator,
  IndicatorId,
  IndicatorNotFound,
  Observation,
  SourceUnavailable,
  Year,
} from "@civicdata/domain"
import { Context, DateTime, Effect, Layer, Option, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http"

import { Cache } from "./Cache.ts"

const base = "https://api.worldbank.org/v2"

interface Query {
  readonly indicator: IndicatorId
  readonly countries: ReadonlyArray<Country>
  readonly from: Year
  readonly to: Year
}

// Every result records when the World Bank was asked, so a cached result
// still reports its original retrieval time as provenance.
const Described = Schema.Struct({
  indicator: Indicator,
  dataset: Schema.String,
  retrievedAt: Schema.DateTimeUtc,
})

type Described = typeof Described.Type

const Series = Schema.Struct({
  observations: Schema.Array(Observation),
  url: Schema.String,
  retrievedAt: Schema.DateTimeUtc,
})

type Series = typeof Series.Type

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
      indicator: { id: metadata.id, name: metadata.name, definition: metadata.sourceNote },
      dataset: metadata.source.value,
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
      rows.map((row) => ({ indicator: row.id, name: row.name, definition: row.sourceNote })),
    ),
    Effect.withSpan("WorldBank.indicators"),
  )

  return WorldBank.of({ describe, observations, indicators })
})

// World Bank indicators change a few times a year at most.
const lifetime = 24 * 60 * 60 * 1000

const DescribedJson = Schema.fromJsonString(Schema.toCodecJson(Described))
const SeriesJson = Schema.fromJsonString(Schema.toCodecJson(Series))

// Bump `v1` when a cached shape changes, so old entries are ignored.
const keys = {
  described: (indicator: IndicatorId) => `worldbank/v1/indicator/${indicator}`,
  series: (query: Query) =>
    `worldbank/v1/series/${query.indicator}/${query.countries.toSorted().join(",")}/${query.from}-${query.to}`,
}

export class WorldBank extends Context.Service<WorldBank, Interface>()(
  "@civicdata/server/WorldBank",
) {
  static readonly layer = Layer.effect(WorldBank, make)

  // Serves a stored result younger than `lifetime`, otherwise asks the World
  // Bank and stores the answer. An entry that no longer decodes is a miss.
  static readonly cached = Layer.effect(
    WorldBank,
    Effect.gen(function* () {
      const live = yield* make
      const cache = yield* Cache

      const remember = Effect.fnUntraced(function* <
        A extends { readonly retrievedAt: DateTime.Utc },
        E,
      >(key: string, json: Schema.Codec<A, string>, fetch: Effect.Effect<A, E>) {
        const stored = Option.flatMap(yield* cache.get(key), Schema.decodeOption(json))
        const now = yield* DateTime.now

        if (
          Option.isSome(stored) &&
          DateTime.toEpochMillis(now) - DateTime.toEpochMillis(stored.value.retrievedAt) < lifetime
        ) {
          return stored.value
        }

        const fresh = yield* fetch

        yield* Schema.encodeEffect(json)(fresh).pipe(
          Effect.flatMap((text) => cache.put(key, text)),
          Effect.tapError((error) => Effect.logWarning("Could not cache", key, error)),
          Effect.ignore,
        )

        return fresh
      })

      return WorldBank.of({
        describe: (indicator) =>
          remember(keys.described(indicator), DescribedJson, live.describe(indicator)),
        observations: (query) => remember(keys.series(query), SeriesJson, live.observations(query)),
        // The catalog keeps its own copy in D1.
        indicators: live.indicators,
      })
    }),
  )

  static readonly live = WorldBank.cached.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Cache.layer),
  )
}
