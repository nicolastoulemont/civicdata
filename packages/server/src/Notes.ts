import {
  type IndicatorId,
  IndicatorNotes,
  IndicatorNotFound,
  SourceUnavailable,
  sourceOf,
} from "@civicdata/domain"
import { Context, DateTime, Effect, Layer, Option, Schedule, Schema } from "effect"
import { HttpClient } from "effect/http"

import { Cache } from "./Cache.ts"
import { Pace } from "./Pace.ts"

interface Interface {
  readonly get: (
    indicator: IndicatorId,
  ) => Effect.Effect<IndicatorNotes, IndicatorNotFound | SourceUnavailable>
}

// The World Development Indicators' metadata for one series: a list of
// fields, each an id and a text.
const Body = Schema.fromJsonString(
  Schema.Struct({
    source: Schema.NonEmptyArray(
      Schema.Struct({
        concept: Schema.NonEmptyArray(
          Schema.Struct({
            variable: Schema.NonEmptyArray(
              Schema.Struct({
                metatype: Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.String })),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
)

const NotesJson = Schema.fromJsonString(Schema.toCodecJson(IndicatorNotes))

// The World Bank rewrites these notes rarely.
const lifetime = 7 * 24 * 60 * 60 * 1000

const unavailable = () => new SourceUnavailable({ source: "World Bank" })

// The first producer a "Source" field credits, when it links their page:
// "World Population Prospects, United Nations (UN), uri: https://population.un.org/wpp/,
// publisher: ...; ..." → World Population Prospects, United Nations (UN).
const producerOf = (source: string | null) => {
  const found = source?.match(/^([^;]+?), uri: (https:\/\/[^\s,;]+)/)

  return found?.[1] === undefined || found[2] === undefined
    ? null
    : { name: found[1], url: found[2] }
}

const make = Effect.gen(function* () {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.filterStatusOk,
    HttpClient.retryTransient({ schedule: Schedule.exponential("250 millis"), times: 2 }),
  )

  const cache = yield* Cache

  const fetch = Effect.fn("Notes.fetch")(function* (indicator: IndicatorId) {
    const url = `https://api.worldbank.org/v2/sources/2/series/${indicator}/metadata?format=json`

    const text = yield* client.get(url).pipe(
      Effect.flatMap((response) => response.text),
      Effect.timeout("15 seconds"),
      Effect.tapError((error) => Effect.logWarning("World Bank request failed", url, error)),
      Effect.mapError(unavailable),
    )

    // An unknown series gets HTTP 200 and an XML error, "Data not found".
    if (text.includes('key="Data not found."')) return yield* new IndicatorNotFound({ indicator })

    const [source] = (yield* Schema.decodeEffect(Body)(text).pipe(
      Effect.tapError((error) => Effect.logWarning("World Bank notes did not decode", url, error)),
      Effect.mapError(unavailable),
    )).source

    const fields = new Map(
      source.concept[0].variable[0].metatype.map(({ id, value }) => [id, value.trim()]),
    )

    const field = (id: string) => {
      const value = fields.get(id)

      return value === undefined || value === "" ? null : value
    }

    return IndicatorNotes.make({
      indicator,
      relevance: field("Developmentrelevance"),
      limitations: field("Limitationsandexceptions"),
      producer: producerOf(field("Source")),
      url,
      retrievedAt: yield* DateTime.now,
    })
  })

  // A stored copy younger than `lifetime`, otherwise the World Bank's, stored.
  // Eurostat and OECD indicators have no such notes.
  const get = Effect.fn("Notes.get")(function* (indicator: IndicatorId) {
    if (sourceOf(indicator) !== "World Bank") return yield* new IndicatorNotFound({ indicator })

    const key = `worldbank/v2/notes/${indicator}`
    const stored = Option.flatMap(yield* cache.get(key), Schema.decodeOption(NotesJson))
    const now = yield* DateTime.now

    if (
      Option.isSome(stored) &&
      DateTime.toEpochMillis(now) - DateTime.toEpochMillis(stored.value.retrievedAt) < lifetime
    ) {
      return stored.value
    }

    const fresh = yield* fetch(indicator)

    yield* Schema.encodeEffect(NotesJson)(fresh).pipe(
      Effect.flatMap((json) => cache.put(key, json)),
      Effect.tapError((error) => Effect.logWarning("Could not cache", key, error)),
      Effect.ignore,
    )

    return fresh
  })

  return Notes.of({ get })
})

// The World Bank's notes on an indicator, beyond its definition.
export class Notes extends Context.Service<Notes, Interface>()("@civicdata/server/Notes") {
  // Needs an HttpClient and a Cache.
  static readonly layer = Layer.effect(Notes, make)

  static readonly live = Notes.layer.pipe(Layer.provide(Pace.http), Layer.provide(Cache.layer))
}
