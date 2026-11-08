import {
  Country,
  type Indicator,
  IndicatorId,
  IndicatorNotFound,
  type ResolvedView,
  SourceUnavailable,
  Year,
} from "@civicdata/domain"
import { Context, Effect, Layer, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http"

const base = "https://api.worldbank.org/v2"

interface Query {
  readonly indicator: IndicatorId
  readonly countries: ReadonlyArray<Country>
  readonly from: Year
  readonly to: Year
}

interface Described {
  readonly indicator: Indicator
  readonly dataset: string
}

interface Series {
  readonly observations: ResolvedView["observations"]
  readonly url: string
}

interface Interface {
  readonly describe: (
    indicator: IndicatorId,
  ) => Effect.Effect<Described, IndicatorNotFound | SourceUnavailable>
  readonly observations: (
    query: Query,
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

// `null` rows means the query matched nothing.
const ObservationsBody = Schema.Union([
  Message,
  Schema.Tuple([Schema.Struct({}), Schema.NullOr(Schema.Array(Row))]),
])

const unavailable = () => new SourceUnavailable({ source: "World Bank" })

export class WorldBank extends Context.Service<WorldBank, Interface>()(
  "@civicdata/server/WorldBank",
) {
  static readonly layer = Layer.effect(
    WorldBank,
    Effect.gen(function* () {
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
        }
      })

      return WorldBank.of({ describe, observations })
    }),
  )

  static readonly live = WorldBank.layer.pipe(Layer.provide(FetchHttpClient.layer))
}
