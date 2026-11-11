import {
  CatalogEntry,
  codesOf,
  type Country,
  Dimension,
  type Dimensions,
  DimensionsMissing,
  type IndicatorId,
  IndicatorNotFound,
  type Source,
  SourceUnavailable,
  sourceOf,
} from "@civicdata/domain"
import {
  Array as Arr,
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Schedule,
  Schema,
} from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

import { type Adapter, Policy } from "./Adapter.ts"
import { Cache } from "./Cache.ts"
import * as Csv from "./Csv.ts"
import { geo } from "./geo.ts"
import { Answer, type Query, widen } from "./Series.ts"
import { plain } from "./text.ts"

// A dataflow's name and description, and for the OECD the order of its
// dimensions, which its data URLs spell out key by key.
const Flow = Schema.Struct({
  name: Schema.NonEmptyString,
  definition: Schema.String,
  dimensions: Schema.Array(Schema.String),
  retrievedAt: Schema.DateTimeUtc,
})

// Every dimension of a dataflow for some countries, with the values it takes,
// and the codes of each series, one per dimension in the same order.
const Options = Schema.Struct({
  dimensions: Schema.Array(Dimension),
  series: Schema.Array(Schema.Array(Schema.String)),
  retrievedAt: Schema.DateTimeUtc,
})

type Options = typeof Options.Type

// The sources that publish through SDMX.
type SdmxSource = Exclude<Source, "World Bank">

// Each SDMX source's adapter. Nothing of theirs is stored yet.
type Interface = { readonly [source in SdmxSource]: Adapter }

export const eurostat = "https://ec.europa.eu/eurostat/api/dissemination"
export const oecd = "https://sdmx.oecd.org/public/rest"

const sdmxCsv = "application/vnd.sdmx.data+csv;version=2.0.0"

// "agency,id,version", as IndicatorId checks it.
export const parts = (indicator: IndicatorId) => {
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

// Eurostat's dataflow list without annotations (`detail=allstubs`): about
// 1.5 MB for 8,000 dataflows, where the full list is 20 MB.
const EurostatFlows = Schema.Struct({
  link: Schema.Struct({
    item: Schema.Array(
      Schema.Struct({
        label: Schema.String,
        extension: Schema.Struct({ id: Schema.String, version: Schema.String }),
      }),
    ),
  }),
})

// The OECD's dataflow list, with descriptions: about 6 MB for 1,500 dataflows.
const OecdFlows = Schema.Struct({
  data: Schema.Struct({
    dataflows: Schema.Array(
      Schema.Struct({
        agencyID: Schema.String,
        id: Schema.String,
        version: Schema.String,
        name: Schema.String,
        description: Schema.optionalKey(Schema.String),
      }),
    ),
  }),
})

const toEntry = Schema.decodeUnknownOption(CatalogEntry)

interface Reply {
  readonly status: number
  readonly body: string
}

// An answer the adapter does not expect, such as OECD's 429 once the Worker's
// shared IP is over its limit, is the source being unavailable.
const refuse = (source: Source, { url, answer }: { url: string; answer: Reply }) =>
  Effect.logWarning("SDMX source refused", url, answer.status, answer.body.slice(0, 300)).pipe(
    Effect.andThen(Effect.fail(new SourceUnavailable({ source }))),
  )

const decode = <A>(
  source: Source,
  { url, body, schema }: { url: string; body: string; schema: Schema.Codec<A, unknown> },
) =>
  Schema.decodeEffect(Schema.fromJsonString(schema))(body).pipe(
    Effect.tapError((error) => Effect.logWarning("SDMX answer not recognized", url, error)),
    Effect.mapError(() => new SourceUnavailable({ source })),
  )

// A data answer's CSV body, when its status is 200.
const accepted = (indicator: IndicatorId, asked: { url: string; answer: Reply }) =>
  asked.answer.status === 200
    ? Effect.succeed({ url: asked.url, csv: asked.answer.body })
    : refuse(sourceOf(indicator), asked)

// What a data request asks besides its countries: the value of some
// dimensions, and either the View's years or each series' latest value.
interface Ask {
  readonly filters: Readonly<Record<string, string>>
  readonly latest: boolean
}

// The OECD key spells out every dimension in order: the countries, annual
// frequency, a picked value, or nothing for a dimension left open.
const keyPart = (
  dimension: string,
  { query, filters }: { query: Query; filters: Ask["filters"] },
) =>
  Match.value(dimension).pipe(
    Match.when("REF_AREA", () => query.countries.join("+")),
    Match.when("FREQ", () => "A"),
    Match.orElse(() => filters[dimension] ?? ""),
  )

const period = (
  query: Query,
  { latest, eurostat: filter }: { latest: boolean; eurostat: boolean },
) =>
  Match.value({ latest, filter }).pipe(
    Match.when({ latest: true }, () => "lastNObservations=1"),
    Match.when({ filter: true }, () => `c[TIME_PERIOD]=ge:${query.from}+le:${query.to}`),
    Match.orElse(() => `startPeriod=${query.from}&endPeriod=${query.to}`),
  )

// The dimensions the View can pick a value of, the values it picked that
// some series takes together, and the dimensions it leaves open. A dimension
// with a single value needs no pick. Picks are kept in the order the dataflow
// lists its dimensions; a value no series takes with the picks kept before it
// is open, like one the dimension does not take. An open dimension lists only
// the values the series take with the picks kept, so that the next pick has a
// series: the OECD's government debt takes EXPENDITURE _Z only, never _T.
const choose = ({ dimensions, series }: Options, picked: Dimensions) => {
  const filters: Record<string, string> = {}
  let matching = series

  for (const [index, dimension] of dimensions.entries()) {
    const code = picked[dimension.id]

    if (code === undefined) continue

    const taking = matching.filter((codes) => codes[index] === code)

    if (Arr.isArrayNonEmpty(taking)) {
      filters[dimension.id] = code
      matching = taking
    }
  }

  const listed = dimensions.flatMap((dimension, index) => {
    if (dimension.options.length < 2) return []

    if (filters[dimension.id] !== undefined) return [dimension]

    const taken = dimension.options.filter(({ code }) =>
      matching.some((codes) => codes[index] === code),
    )

    return [Arr.isArrayNonEmpty(taken) ? { ...dimension, options: taken } : dimension]
  })

  return {
    listed,
    filters,
    open: listed.filter((dimension) => filters[dimension.id] === undefined),
  }
}

const area = (indicator: IndicatorId) =>
  Csv.areas[sourceOf(indicator) === "Eurostat" ? "Eurostat" : "OECD"]

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
    const ask = (source: Source, url: string, accept: string) => {
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
        Effect.mapError(() => new SourceUnavailable({ source })),
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

      const answer = yield* ask(source, url, accept)

      if (answer.status === 404) return yield* new IndicatorNotFound({ indicator })

      if (answer.status !== 200) return yield* refuse(source, { url, answer })

      const retrievedAt = yield* DateTime.now

      if (source === "Eurostat") {
        const { label, extension } = yield* decode(source, {
          url,
          body: answer.body,
          schema: EurostatFlow,
        })

        return {
          name: label,
          definition: plain(extension.description ?? ""),
          dimensions: [],
          retrievedAt,
        }
      }

      const { data } = yield* decode(source, { url, body: answer.body, schema: OecdFlow })
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

    // Lists a source's dataflows. It keeps those whose id is one of the
    // source's own: Eurostat also lists saved views of its datasets, such as
    // "LFSQ_EGAN21$DV_3701", and the OECD lists dataflows that ESTAT and
    // IAEG-SDGs maintain.
    const list = Effect.fn("Sdmx.list")(function* (source: SdmxSource) {
      const [url, accept] =
        source === "Eurostat"
          ? [
              `${eurostat}/sdmx/2.1/dataflow/ESTAT/all/latest?format=JSON&lang=en&detail=allstubs`,
              "application/json",
            ]
          : [`${oecd}/dataflow/all`, "application/vnd.sdmx.structure+json;version=1.0"]

      const answer = yield* ask(source, url, accept)

      if (answer.status !== 200) return yield* refuse(source, { url, answer })

      const listed =
        source === "Eurostat"
          ? (yield* decode(source, {
              url,
              body: answer.body,
              schema: EurostatFlows,
            })).link.item.map(({ label, extension }) => ({
              indicator: `ESTAT,${extension.id},${extension.version}`,
              name: label,
              definition: "",
            }))
          : (yield* decode(source, {
              url,
              body: answer.body,
              schema: OecdFlows,
            })).data.dataflows.map(({ agencyID, id, version, name, description }) => ({
              indicator: `${agencyID},${id},${version}`,
              name,
              definition: plain(description ?? ""),
            }))

      return listed.flatMap((each) =>
        Option.match(toEntry(each), {
          onNone: () => [],
          onSome: (entry) => (sourceOf(entry.indicator) === source ? [entry] : []),
        }),
      )
    })

    const cachedFlow = (indicator: IndicatorId) =>
      remember(`sdmx/v2/flow/${indicator}`, {
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
    const eurostatData = Effect.fn("Sdmx.eurostat")(function* (
      query: Query,
      { filters, latest, accept }: Ask & { accept: string },
    ) {
      const { id, version } = parts(query.indicator)

      const picks = Object.entries(filters)
        .map(([dimension, code]) => `&c[${dimension}]=${code}`)
        .join("")

      const attempt = (codes: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const url = `${eurostat}/sdmx/3.0/data/dataflow/ESTAT/${id}/${version}/*?c[geo]=${codes.join(",")}&c[freq]=A${picks}&${period(query, { latest, eurostat: true })}&compress=false`

          return { url, answer: yield* ask("Eurostat", url, accept) }
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
    const oecdData = Effect.fn("Sdmx.oecd")(function* (
      query: Query,
      { filters, latest, accept }: Ask & { accept: string },
    ) {
      const { agency, id, version } = parts(query.indicator)
      const { dimensions } = yield* cachedFlow(query.indicator)
      const key = dimensions.map((dimension) => keyPart(dimension, { query, filters })).join(".")
      const url = `${oecd}/data/${agency},${id},${version}/${key}?${period(query, { latest, eurostat: false })}`
      const answer = yield* ask("OECD", url, accept)

      // The OECD answers 404 for a query that matches no observation.
      if (answer.status === 404) return { url, csv: undefined }

      return yield* accepted(query.indicator, { url, answer })
    })

    const data = (query: Query, options: Ask & { accept: string }) =>
      sourceOf(query.indicator) === "Eurostat"
        ? eurostatData(query, options)
        : oecdData(query, options)

    // Each series' latest value with labels: one row per series, enough to
    // list every dimension and the values it takes for these countries.
    const options = Effect.fn("Sdmx.options")(function* (query: Query) {
      const { url, csv } = yield* data(query, {
        filters: {},
        latest: true,
        accept: `${sdmxCsv};labels=both`,
      })

      const listing =
        csv === undefined ? { dimensions: [], series: [] } : Csv.options(csv, area(query.indicator))

      if (listing === undefined)
        return yield* refuse(sourceOf(query.indicator), {
          url,
          answer: { status: 200, body: csv ?? "" },
        })

      return { ...listing, retrievedAt: yield* DateTime.now }
    })

    const cachedOptions = (query: Query) =>
      remember(keys.options(query), {
        json: OptionsJson,
        fresh: freshness(query.indicator),
        fetch: options(query),
      })

    // Lists the dataflow's dimensions first, so a View that leaves one open
    // fails before its data is asked for, with the values it could pick.
    const observations = Effect.fn("Sdmx.observations")(function* (query: Query) {
      const { listed, filters, open } = choose(yield* cachedOptions(query), query.dimensions)

      if (Arr.isArrayNonEmpty(open))
        return yield* new DimensionsMissing({
          indicator: query.indicator,
          dimensions: listed,
          open: Arr.map(open, ({ id }) => id),
        })

      const { url, csv } = yield* data(query, { filters, latest: false, accept: sdmxCsv })
      const retrievedAt = yield* DateTime.now

      if (csv === undefined) return { observations: [], url, retrievedAt, dimensions: listed }

      const parsed = Csv.observations(csv, area(query.indicator))

      if (parsed === undefined)
        return yield* refuse(sourceOf(query.indicator), { url, answer: { status: 200, body: csv } })

      // A series the options did not list, e.g. one with no recent value.
      const mixed = listed.filter((dimension) => parsed.mixed.includes(dimension.id))

      if (Arr.isArrayNonEmpty(mixed))
        return yield* new DimensionsMissing({
          indicator: query.indicator,
          dimensions: listed,
          open: Arr.map(mixed, ({ id }) => id),
        })

      return { observations: parsed.observations, url, retrievedAt, dimensions: listed }
    })

    const adapter = (source: SdmxSource): Adapter => ({
      policy: Policy.None(),
      // The catalog keeps its own copy in D1.
      list: list(source),
      describe,
      fetch: (query) =>
        remember(keys.series(query), {
          json: SeriesJson,
          fresh: freshness(query.indicator),
          fetch: observations(query),
        }),
    })

    return Sdmx.of({ Eurostat: adapter("Eurostat"), OECD: adapter("OECD") })
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
const OptionsJson = Schema.fromJsonString(Schema.toCodecJson(Options))
const SeriesJson = Schema.fromJsonString(Schema.toCodecJson(Answer))

const countriesKey = (countries: ReadonlyArray<Country>) => countries.toSorted().join(",")

// Bump a key's version when what it caches changes, so old entries are
// ignored.
const keys = {
  options: (query: Query) => `sdmx/v2/options/${query.indicator}/${countriesKey(query.countries)}`,
  series: (query: Query) =>
    `sdmx/v1/series/${query.indicator}/${countriesKey(query.countries)}/${query.from}-${query.to}/${codesOf(query.dimensions)}`,
}

// Eurostat and OECD data, read through their SDMX REST APIs as SDMX-CSV.
export class Sdmx extends Context.Service<Sdmx, Interface>()("@civicdata/server/Sdmx") {
  static readonly layer = Layer.effect(Sdmx, make(passthrough))

  // Serves a stored dataflow, list of dimensions or series while its source
  // has not published since, otherwise asks the source and stores the answer.
  // Asks for the recent years at once (`widen`).
  static readonly cached = Layer.effect(
    Sdmx,
    Effect.flatMap(Cache.remember, make).pipe(
      Effect.map(({ Eurostat, OECD }) =>
        Sdmx.of({
          Eurostat: { ...Eurostat, fetch: widen(Eurostat.fetch) },
          OECD: { ...OECD, fetch: widen(OECD.fetch) },
        }),
      ),
    ),
  )
}
