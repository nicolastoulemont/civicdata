import {
  type Country,
  countries,
  DimensionsMissing,
  type IndicatorId,
  IndicatorNotFound,
  SourceUnavailable,
  sourceOf,
  Year,
} from "@civicdata/domain"
import { Context, DateTime, Duration, Effect, Layer, Match, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"

import { Cache } from "./Cache.ts"
import { geo } from "./geo.ts"
import type { Described, Query } from "./Series.ts"
import { Series } from "./Series.ts"

// A dataflow's name and description, and for the OECD the order of its
// dimensions, which its data URLs spell out key by key.
const Flow = Schema.Struct({
  name: Schema.NonEmptyString,
  definition: Schema.String,
  dimensions: Schema.Array(Schema.String),
  retrievedAt: Schema.DateTimeUtc,
})

interface Interface {
  readonly describe: (
    indicator: IndicatorId,
  ) => Effect.Effect<Described, IndicatorNotFound | SourceUnavailable>
  readonly observations: (
    query: Query,
  ) => Effect.Effect<Series, IndicatorNotFound | SourceUnavailable | DimensionsMissing>
}

const eurostat = "https://ec.europa.eu/eurostat/api/dissemination"
const oecd = "https://sdmx.oecd.org/public/rest"

const sdmxCsv = "application/vnd.sdmx.data+csv;version=2.0.0"

// "agency,id,version", as IndicatorId checks it.
const parts = (indicator: IndicatorId) => {
  const [agency = "", id = "", version = ""] = indicator.split(",")

  return { agency, id, version }
}

// Eurostat's dataflow query answers JSON-stat with a label and, for most
// dataflows, a description; its SDMX structures come as XML only.
const EurostatFlow = Schema.Struct({
  label: Schema.NonEmptyString,
  extension: Schema.Struct({ description: Schema.optionalKey(Schema.String) }),
})

const OecdFlow = Schema.Struct({
  data: Schema.Struct({
    dataflows: Schema.Tuple([
      Schema.Struct({
        name: Schema.NonEmptyString,
        description: Schema.optionalKey(Schema.String),
      }),
    ]),
    dataStructures: Schema.Tuple([
      Schema.Struct({
        dataStructureComponents: Schema.Struct({
          dimensionList: Schema.Struct({
            dimensions: Schema.Array(Schema.Struct({ id: Schema.String, position: Schema.Int })),
          }),
        }),
      }),
    ]),
  }),
})

// OECD descriptions are HTML paragraphs; the page shows plain text.
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()

// Where each source names the country in its data, and how. OECD codes are
// ISO 3166-1 alpha-3, like ours; Eurostat's are two letters.
interface Area {
  readonly column: string
  readonly country: ReadonlyMap<string, Country>
}

const areas: Record<"Eurostat" | "OECD", Area> = {
  Eurostat: { column: "geo", country: new Map(countries.map(({ code }) => [geo[code], code])) },
  OECD: { column: "REF_AREA", country: new Map(countries.map(({ code }) => [code, code])) },
}

const isYear = Schema.is(Year)

// One SDMX-CSV line, with RFC 4180 quoting. Codes and numbers are never
// quoted; attributes may be.
const fields = (line: string) => {
  if (!line.includes('"')) return line.split(",")

  const values: Array<string> = []
  let value = ""
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (quoted && char === '"' && line[index + 1] === '"') {
      value += '"'
      index += 1
    } else if (char === '"') quoted = !quoted
    else if (char === "," && !quoted) {
      values.push(value)
      value = ""
    } else value += char
  }

  values.push(value)

  return values
}

// Where an SDMX-CSV 2.0 answer keeps each field: its header names the time,
// value and country columns, and the dimension columns sit between the
// structure columns and OBS_VALUE.
const layout = (header: string, area: Area) => {
  const columns = fields(header)
  const at = (name: string) => columns.indexOf(name)
  const time = at("TIME_PERIOD")
  const value = at("OBS_VALUE")
  const place = at(area.column)
  const first = Math.max(at("STRUCTURE_ID"), at("ACTION")) + 1

  const dimensions = columns
    .slice(first, value)
    .flatMap((name, offset) =>
      name === area.column || name === "TIME_PERIOD" ? [] : [{ name, index: first + offset }],
    )

  return time === -1 || value === -1 || place === -1
    ? undefined
    : { time, value, place, dimensions }
}

// The observations in an SDMX-CSV 2.0 answer, one per country and year. When
// more than one series comes back, the dimensions whose values differ are the
// ones the query left open. Parsed by hand: a schema per row costs more CPU
// than a Worker on the free plan gets.
const parse = (text: string, area: Area) => {
  const [header = "", ...lines] = text.split(/\r?\n/)
  const columns = layout(header, area)

  if (columns === undefined) return undefined

  const { time, value, place, dimensions } = columns
  const seen = dimensions.map(() => new Set<string>())
  const observations: Array<Series["observations"][number]> = []

  for (const line of lines.filter((each) => each !== "")) {
    const row = fields(line)
    const country = area.country.get(row[place] ?? "")
    const year = Number(row[time])
    const number = row[value] === "" ? Number.NaN : Number(row[value])

    dimensions.forEach(({ index }, position) => seen[position]?.add(row[index] ?? ""))

    if (country !== undefined && isYear(year) && Number.isFinite(number))
      observations.push({ country, year, value: number })
  }

  const open = dimensions.flatMap(({ name }, position) =>
    (seen[position]?.size ?? 0) > 1 ? [name] : [],
  )

  return { observations, open }
}

interface Answer {
  readonly status: number
  readonly body: string
}

// An answer the adapter does not expect, such as OECD's 429 once the Worker's
// shared IP is over its limit, is the source being unavailable.
const refuse = (indicator: IndicatorId, { url, answer }: { url: string; answer: Answer }) =>
  Effect.logWarning("SDMX source refused", url, answer.status, answer.body.slice(0, 300)).pipe(
    Effect.andThen(Effect.fail(new SourceUnavailable({ source: sourceOf(indicator) }))),
  )

const decode = <A>(
  indicator: IndicatorId,
  { url, body, schema }: { url: string; body: string; schema: Schema.Codec<A, unknown> },
) =>
  Schema.decodeEffect(Schema.fromJsonString(schema))(body).pipe(
    Effect.tapError((error) => Effect.logWarning("SDMX answer not recognized", url, error)),
    Effect.mapError(() => new SourceUnavailable({ source: sourceOf(indicator) })),
  )

// A data answer's CSV body, when its status is 200.
const accepted = (indicator: IndicatorId, asked: { url: string; answer: Answer }) =>
  asked.answer.status === 200
    ? Effect.succeed({ url: asked.url, csv: asked.answer.body })
    : refuse(indicator, asked)

// The OECD key spells out every dimension in order: the countries, annual
// frequency, and every other dimension left open.
const keyPart = (dimension: string, asked: ReadonlyArray<Country>) =>
  Match.value(dimension).pipe(
    Match.when("REF_AREA", () => asked.join("+")),
    Match.when("FREQ", () => "A"),
    Match.orElse(() => ""),
  )

const make = (remember: Remember) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.retryTransient({
        retryOn: "errors-only",
        schedule: Schedule.exponential("250 millis"),
        times: 2,
      }),
    )

    // Asks a source in English and hands back its answer whatever the status,
    // asking up to twice more after a server error. The OECD answers 500 to
    // `Accept-Language: *`, which Node's fetch sends unless told otherwise.
    // Transport failures and timeouts become SourceUnavailable; the cause is
    // logged.
    const ask = (indicator: IndicatorId, url: string, accept: string) => {
      const once = client
        .execute(
          HttpClientRequest.get(url).pipe(
            HttpClientRequest.setHeaders({ accept, "accept-language": "en" }),
          ),
        )
        .pipe(
          Effect.flatMap((response) =>
            Effect.map(response.text, (body) => ({ status: response.status, body })),
          ),
        )

      return once.pipe(
        Effect.repeat({
          schedule: Schedule.exponential("1 second"),
          times: 2,
          while: (answer) => answer.status >= 500,
        }),
        Effect.timeout("15 seconds"),
        Effect.tapError((error) => Effect.logWarning("SDMX request failed", url, error)),
        Effect.mapError(() => new SourceUnavailable({ source: sourceOf(indicator) })),
      )
    }

    const flow = Effect.fn("Sdmx.flow")(function* (indicator: IndicatorId) {
      const { agency, id, version } = parts(indicator)
      const source = sourceOf(indicator)

      const [url, accept] =
        source === "Eurostat"
          ? [`${eurostat}/sdmx/2.1/dataflow/ESTAT/${id}/${version}?format=JSON`, "application/json"]
          : [
              `${oecd}/dataflow/${agency}/${id}/${version}?references=datastructure`,
              "application/vnd.sdmx.structure+json;version=1.0",
            ]

      const answer = yield* ask(indicator, url, accept)

      if (answer.status === 404) return yield* new IndicatorNotFound({ indicator })

      if (answer.status !== 200) return yield* refuse(indicator, { url, answer })

      const retrievedAt = yield* DateTime.now

      if (source === "Eurostat") {
        const { label, extension } = yield* decode(indicator, {
          url,
          body: answer.body,
          schema: EurostatFlow,
        })

        return { name: label, definition: extension.description ?? "", dimensions: [], retrievedAt }
      }

      const { data } = yield* decode(indicator, { url, body: answer.body, schema: OecdFlow })
      const [dataflow] = data.dataflows
      const [structure] = data.dataStructures

      return {
        name: dataflow.name,
        definition: plain(dataflow.description ?? ""),
        dimensions: structure.dataStructureComponents.dimensionList.dimensions
          .toSorted((a, b) => a.position - b.position)
          .map((dimension) => dimension.id),
        retrievedAt,
      }
    })

    const cachedFlow = (indicator: IndicatorId) =>
      remember(`sdmx/v1/flow/${indicator}`, {
        json: FlowJson,
        fresh: freshness(indicator),
        fetch: flow(indicator),
      })

    const describe = Effect.fn("Sdmx.describe")(function* (indicator: IndicatorId) {
      const found = yield* cachedFlow(indicator)

      return {
        indicator: { id: indicator, name: found.name, definition: found.definition },
        dataset: found.name,
        retrievedAt: found.retrievedAt,
      }
    })

    // Eurostat filters by dimension name. It gzips its answer, without saying
    // so in Content-Encoding, unless asked `compress=false`. It rejects a
    // whole query that names a country its dataflow does not cover, so those
    // countries are dropped and asked once more; they come back missing.
    const eurostatSeries = Effect.fn("Sdmx.eurostat")(function* (query: Query) {
      const { id, version } = parts(query.indicator)

      const attempt = (codes: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const url = `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/${id}/${version}/*?c[geo]=${codes.join(",")}&c[freq]=A&c[TIME_PERIOD]=ge:${query.from}+le:${query.to}&compress=false`

          return { url, answer: yield* ask(query.indicator, url, sdmxCsv) }
        })

      const codes = query.countries.map((country) => geo[country])
      const first = yield* attempt(codes)

      const rejected = new Set(
        [...first.answer.body.matchAll(/GEO=([A-Za-z0-9_]+)/g)].map((match) => match[1]),
      )

      const kept = codes.filter((code) => !rejected.has(code))

      const asked =
        first.answer.status === 400 && rejected.size > 0 && kept.length > 0
          ? yield* attempt(kept)
          : first

      // Eurostat answers 404 for an unknown dataflow, and 400 for a query its
      // data cannot answer: countries it does not cover, years without values
      // for them, or a dataflow without annual data.
      if (asked.answer.status === 404)
        return yield* new IndicatorNotFound({ indicator: query.indicator })

      if (
        asked.answer.status === 400 &&
        asked.answer.body.includes("INVALID_QUERY_DIMENSION_VALUE")
      )
        return { url: asked.url, csv: undefined }

      return yield* accepted(query.indicator, asked)
    })

    // The OECD's edge cache ignores the `c[...]` filters, so its data URLs
    // spell out the key.
    const oecdSeries = Effect.fn("Sdmx.oecd")(function* (query: Query) {
      const { agency, id, version } = parts(query.indicator)
      const { dimensions } = yield* cachedFlow(query.indicator)
      const key = dimensions.map((dimension) => keyPart(dimension, query.countries)).join(".")
      const url = `${oecd}/data/${agency},${id},${version}/${key}?startPeriod=${query.from}&endPeriod=${query.to}`
      const answer = yield* ask(query.indicator, url, sdmxCsv)

      // The OECD answers 404 for a query that matches no observation.
      if (answer.status === 404) return { url, csv: undefined }

      return yield* accepted(query.indicator, { url, answer })
    })

    const observations = Effect.fn("Sdmx.observations")(function* (query: Query) {
      const source = sourceOf(query.indicator)
      const { url, csv } = yield* source === "Eurostat" ? eurostatSeries(query) : oecdSeries(query)
      const retrievedAt = yield* DateTime.now

      if (csv === undefined) return { observations: [], url, retrievedAt }

      const parsed = parse(csv, areas[source === "Eurostat" ? "Eurostat" : "OECD"])

      if (parsed === undefined)
        return yield* refuse(query.indicator, { url, answer: { status: 200, body: csv } })

      const [open, ...more] = parsed.open

      if (open !== undefined)
        return yield* new DimensionsMissing({
          indicator: query.indicator,
          dimensions: [open, ...more],
        })

      return { observations: parsed.observations, url, retrievedAt }
    })

    return Sdmx.of({
      describe,
      observations: (query) =>
        remember(keys.series(query), {
          json: SeriesJson,
          fresh: freshness(query.indicator),
          fetch: observations(query),
        }),
    })
  })

type Remember = Effect.Success<typeof Cache.remember>

// Without a cache every call asks the source.
const passthrough: Remember = (_key, { fetch }) => fetch

// Eurostat updates its database twice a day, at 11:00 and 23:00 in
// Luxembourg. A result stays fresh until the next update after it.
const luxembourg = DateTime.zoneMakeNamedUnsafe("Europe/Luxembourg")

const atHour = (day: DateTime.Zoned, hour: number) =>
  DateTime.setParts(day, { hour, minute: 0, second: 0, millisecond: 0 })

const lastUpdate = (now: DateTime.Utc) => {
  const local = DateTime.setZone(now, luxembourg)
  const hour = DateTime.getPart(local, "hour")

  if (hour >= 23) return atHour(local, 23)

  if (hour >= 11) return atHour(local, 11)

  return atHour(DateTime.subtract(local, { days: 1 }), 23)
}

// The OECD publishes on no fixed schedule.
const oecdLifetime = Duration.days(1)

const freshness = (indicator: IndicatorId) => (retrievedAt: DateTime.Utc, now: DateTime.Utc) =>
  sourceOf(indicator) === "Eurostat"
    ? DateTime.isGreaterThanOrEqualTo(retrievedAt, lastUpdate(now))
    : Duration.isLessThan(DateTime.distance(retrievedAt, now), oecdLifetime)

const FlowJson = Schema.fromJsonString(Schema.toCodecJson(Flow))
const SeriesJson = Schema.fromJsonString(Schema.toCodecJson(Series))

// Bump `v1` when a cached shape changes, so old entries are ignored.
const keys = {
  series: (query: Query) =>
    `sdmx/v1/series/${query.indicator}/${query.countries.toSorted().join(",")}/${query.from}-${query.to}`,
}

// Eurostat and OECD data, read through their SDMX REST APIs as SDMX-CSV.
export class Sdmx extends Context.Service<Sdmx, Interface>()("@civicdata/server/Sdmx") {
  static readonly layer = Layer.effect(Sdmx, make(passthrough))

  // Serves a stored dataflow or series while its source has not published
  // since, otherwise asks the source and stores the answer.
  static readonly cached = Layer.effect(
    Sdmx,
    Effect.flatMap(Cache.remember, (remember) => make(remember)),
  )

  static readonly live = Sdmx.cached.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Cache.layer),
  )
}
