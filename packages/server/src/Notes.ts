import {
  type Country,
  Dimensions,
  type IndicatorId,
  IndicatorNotes,
  IndicatorNotFound,
  type Source,
  SourceUnavailable,
  sourceOf,
} from "@openfacts/domain"
import { Context, DateTime, Duration, Effect, Layer, Match, Option, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { decodeXML } from "entities"
import { unzipSync } from "fflate"

import { Cache } from "./Cache.ts"
import * as Csv from "./Csv.ts"
import { Pace } from "./Pace.ts"
import { eurostat, oecd, parts } from "./Sdmx.ts"
import { plain } from "./text.ts"

// The part of a dataflow a chart shows. The OECD writes notes on single
// countries and series; Eurostat and the World Bank write them on the whole
// indicator.
interface Scope {
  readonly countries?: ReadonlyArray<Country>
  readonly dimensions?: Dimensions
}

// A note the OECD attaches to some of a dataflow's countries and series.
type OecdNote = (typeof IndicatorNotes.cases.OECD.Type)["notes"][number]

interface Interface {
  readonly get: (
    indicator: IndicatorId,
    scope?: Scope,
  ) => Effect.Effect<IndicatorNotes, IndicatorNotFound | SourceUnavailable>
}

// The World Development Indicators' metadata for one series: a list of
// fields, each an id and a text.
const WorldBankBody = Schema.fromJsonString(
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

// A Eurostat dataflow's annotations, among them the link to its reference
// metadata as SDMX (ESMS_SDMX).
const EurostatFlow = Schema.fromJsonString(
  Schema.Struct({
    extension: Schema.Struct({
      annotation: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({ type: Schema.String, href: Schema.optionalKey(Schema.String) }),
        ),
      ),
    }),
  }),
)

const NotesJson = Schema.fromJsonString(Schema.toCodecJson(IndicatorNotes))

// Sources rewrite these notes rarely.
const lifetime = Duration.weeks(1)

const unavailable = (source: Source) => () => new SourceUnavailable({ source })

// The first producer a "Source" field credits, when it links their page:
// "World Population Prospects, United Nations (UN), uri: https://population.un.org/wpp/,
// publisher: ...; ..." → World Population Prospects, United Nations (UN).
const producerOf = (source: string | null) => {
  const found = source?.match(/^([^;]+?), uri: (https:\/\/[^\s,;]+)/)

  return found?.[1] === undefined || found[2] === undefined
    ? null
    : { name: found[1], url: found[2] }
}

const written = (text: string | undefined) => {
  const trimmed = text?.trim() ?? ""

  return trimmed === "" ? null : trimmed
}

// One section of an ESMS file as plain text. Each holds HTML, escaped in the
// XML: <generic:Attribute id="COMPAR_TIME"><generic:Value>&lt;p&gt;...
const esmsSection = (xml: string, id: string) => {
  const found = xml.match(
    new RegExp(
      `<generic:Attribute id="${id}">\\s*(?:<common:Annotations>[\\s\\S]*?</common:Annotations>\\s*)?<generic:Value>([\\s\\S]*?)</generic:Value>`,
    ),
  )

  return written(found?.[1] === undefined ? undefined : plain(decodeXML(found[1])))
}

// The English text of an OECD reference metadata field, which holds each
// language's HTML in turn: en:"<p>...</p>",fr:"<p>...</p>". Quotes inside
// are escaped with a backslash.
const english = (field: string | undefined) => {
  const found = field?.match(/(?:^|,)en:"((?:[^"\\]|\\.)*)"/)

  return written(found?.[1] === undefined ? undefined : plain(found[1].replace(/\\(.)/g, "$1")))
}

// A record's dimensions besides the country, frequency and time, left out
// when open ("~").
const notOpen = (value: string | undefined): value is string =>
  value !== undefined && value !== "" && value !== "~"

const decodeDimensions = Schema.decodeUnknownOption(Dimensions)

// The OECD's notes on its annual series, one per record that writes one of
// the sections OecdNote keeps. Records about a group of countries, such as
// the euro area, are left out: charts show single countries.
const oecdNotes = (csv: string): ReadonlyArray<OecdNote> =>
  Csv.records(csv).flatMap((record) => {
    const area = record.get("REF_AREA")
    const country = notOpen(area) ? Csv.areas.OECD.country.get(area) : null
    const frequency = record.get("FREQ")

    const names = [...record.keys()]
    const first = names.indexOf("ACTION") + 1
    const last = names.indexOf("TIME_PERIOD")

    const series = decodeDimensions(
      Object.fromEntries(
        names.slice(first, last).flatMap((name) => {
          const value = record.get(name)

          return name === "REF_AREA" || name === "FREQ" || !notOpen(value) ? [] : [[name, value]]
        }),
      ),
    )

    const sections = {
      concepts: english(record.get("STAT_CONC_DEF")),
      quality: english(record.get("QUALITY_ASSMNT")),
      limitations: english(record.get("REC_USE_LIM")),
      comment: english(record.get("COMMENT")),
    }

    if (
      country === undefined ||
      (notOpen(frequency) && frequency !== "A") ||
      Option.isNone(series) ||
      Object.values(sections).every((section) => section === null)
    ) {
      return []
    }

    return [{ country, series: series.value, ...sections }]
  })

// A note applies to the scope when it is about every country or one of the
// scope's, and each dimension it names takes its value or is not picked.
const applies =
  ({ countries = [], dimensions = {} }: Scope) =>
  (note: OecdNote) => {
    const picked: Readonly<Record<string, string>> = dimensions

    return (
      (note.country === null || countries.includes(note.country)) &&
      Object.entries(note.series).every(
        ([dimension, code]) => picked[dimension] === undefined || picked[dimension] === code,
      )
    )
  }

// An answer the adapter does not expect is the source being unavailable.
const refuse = (source: Source, { url, status }: { url: string; status: number }) =>
  Effect.logWarning("Notes source refused", url, status).pipe(
    Effect.andThen(Effect.fail(new SourceUnavailable({ source }))),
  )

const make = Effect.gen(function* () {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.retryTransient({
      retryOn: "errors-only",
      schedule: Schedule.exponential("250 millis"),
      times: 2,
    }),
  )

  const remember = yield* Cache.remember

  // Asks a source and hands back its answer whatever the status. Transport
  // failures and timeouts are the source being unavailable; the cause is
  // logged.
  const ask = (source: Source, request: HttpClientRequest.HttpClientRequest) =>
    client.execute(request).pipe(
      Effect.timeout("30 seconds"),
      Effect.tapError((error) => Effect.logWarning("Notes request failed", request.url, error)),
      Effect.mapError(unavailable(source)),
    )

  const worldBank = Effect.fn("Notes.worldBank")(function* (indicator: IndicatorId) {
    const url = `https://api.worldbank.org/v2/sources/2/series/${indicator}/metadata?format=json`
    const response = yield* ask("World Bank", HttpClientRequest.get(url))

    if (response.status !== 200)
      return yield* refuse("World Bank", { url, status: response.status })

    const text = yield* response.text.pipe(Effect.mapError(unavailable("World Bank")))

    // An unknown series gets HTTP 200 and an XML error, "Data not found".
    if (text.includes('key="Data not found."')) return yield* new IndicatorNotFound({ indicator })

    const [source] = (yield* Schema.decodeEffect(WorldBankBody)(text).pipe(
      Effect.tapError((error) => Effect.logWarning("World Bank notes did not decode", url, error)),
      Effect.mapError(unavailable("World Bank")),
    )).source

    const fields = new Map(
      source.concept[0].variable[0].metatype.map(({ id, value }) => [id, value]),
    )

    const field = (id: string) => written(fields.get(id))

    return IndicatorNotes.cases["World Bank"].make({
      indicator,
      relevance: field("Developmentrelevance"),
      limitations: field("Limitationsandexceptions"),
      methodology: field("Statisticalconceptandmethodology"),
      producer: producerOf(field("Source")),
      url,
      retrievedAt: yield* DateTime.now,
    })
  })

  // The dataflow links its reference metadata as a zip of SDMX files, whose
  // `.sdmx.xml` holds the ESMS sections. Eurostat's SDMX APIs answer no
  // metadata query. A dataflow without a link has no notes.
  const eurostatNotes = Effect.fn("Notes.eurostat")(function* (indicator: IndicatorId) {
    const { id, version } = parts(indicator)
    const flowUrl = `${eurostat}/sdmx/2.1/dataflow/ESTAT/${id}/${version}?format=JSON`
    const flow = yield* ask("Eurostat", HttpClientRequest.get(flowUrl))

    if (flow.status === 404) return yield* new IndicatorNotFound({ indicator })

    if (flow.status !== 200) return yield* refuse("Eurostat", { url: flowUrl, status: flow.status })

    const { extension } = yield* flow.text.pipe(
      Effect.flatMap(Schema.decodeEffect(EurostatFlow)),
      Effect.tapError((error) => Effect.logWarning("Eurostat dataflow did not decode", error)),
      Effect.mapError(unavailable("Eurostat")),
    )

    const url = extension.annotation?.find(({ type }) => type === "ESMS_SDMX")?.href
    const retrievedAt = yield* DateTime.now

    if (url === undefined) {
      return IndicatorNotes.cases.Eurostat.make({
        indicator,
        concepts: null,
        accuracy: null,
        comparability: { countries: null, time: null },
        coherence: null,
        url: flowUrl,
        retrievedAt,
      })
    }

    const zip = yield* ask("Eurostat", HttpClientRequest.get(url))

    if (zip.status !== 200) return yield* refuse("Eurostat", { url, status: zip.status })

    const bytes = yield* zip.arrayBuffer.pipe(Effect.mapError(unavailable("Eurostat")))

    const xml = yield* Effect.try(() => {
      const [file] = Object.values(
        unzipSync(new Uint8Array(bytes), { filter: ({ name }) => name.endsWith(".sdmx.xml") }),
      )

      if (file === undefined) throw new Error("no .sdmx.xml in the zip")

      return new TextDecoder().decode(file)
    }).pipe(
      Effect.tapError((error) => Effect.logWarning("Eurostat ESMS did not unzip", url, error)),
      Effect.mapError(unavailable("Eurostat")),
    )

    return IndicatorNotes.cases.Eurostat.make({
      indicator,
      concepts: esmsSection(xml, "STAT_CONC_DEF"),
      accuracy: esmsSection(xml, "ACCURACY_OVERALL"),
      comparability: {
        countries: esmsSection(xml, "COMPAR_GEO"),
        time: esmsSection(xml, "COMPAR_TIME"),
      },
      coherence: esmsSection(xml, "COHER_X_DOM"),
      url,
      retrievedAt,
    })
  })

  // The dataflow's reference metadata, as its Data Explorer reads it: an
  // SDMX 3.0 data query for attributes only. The OECD answers 204 for a
  // dataflow without any, and for one it does not have.
  const oecdNotesOf = Effect.fn("Notes.oecd")(function* (indicator: IndicatorId) {
    const { agency, id, version } = parts(indicator)
    const url = `${oecd}/v2/data/dataflow/${agency}/${id}/${version}/*?attributes=msd&measures=none`

    const response = yield* ask(
      "OECD",
      HttpClientRequest.get(url).pipe(
        HttpClientRequest.setHeaders({
          accept: "application/vnd.sdmx.data+csv;version=2.0.0",
          "accept-language": "en",
        }),
      ),
    )

    const retrievedAt = yield* DateTime.now

    if (response.status === 204 || response.status === 404) {
      return IndicatorNotes.cases.OECD.make({ indicator, notes: [], url, retrievedAt })
    }

    if (response.status !== 200) return yield* refuse("OECD", { url, status: response.status })

    const csv = yield* response.text.pipe(Effect.mapError(unavailable("OECD")))

    return IndicatorNotes.cases.OECD.make({
      indicator,
      notes: oecdNotes(csv),
      url,
      retrievedAt,
    })
  })

  // A stored copy younger than `lifetime`, otherwise the source's, stored.
  const get = Effect.fn("Notes.get")(function* (indicator: IndicatorId, scope: Scope = {}) {
    const notes = yield* remember(`notes/v3/${indicator}`, {
      json: NotesJson,
      fresh: (retrievedAt, now) =>
        Duration.isLessThan(DateTime.distance(retrievedAt, now), lifetime),
      fetch: Match.value(sourceOf(indicator)).pipe(
        Match.when("World Bank", () => worldBank(indicator)),
        Match.when("Eurostat", () => eurostatNotes(indicator)),
        Match.when("OECD", () => oecdNotesOf(indicator)),
        Match.orElse(() => Effect.fail(new IndicatorNotFound({ indicator }))),
      ),
    })

    return IndicatorNotes.guards.OECD(notes)
      ? IndicatorNotes.cases.OECD.make({ ...notes, notes: notes.notes.filter(applies(scope)) })
      : notes
  })

  return Notes.of({ get })
})

// What each source writes about an indicator beyond its definition: the
// World Bank's notes on a series, Eurostat's reference metadata on a
// dataset, and the OECD's notes on a dataflow's countries and series.
export class Notes extends Context.Service<Notes, Interface>()("@openfacts/server/Notes") {
  // Needs an HttpClient and a Cache.
  static readonly layer = Layer.effect(Notes, make)

  static readonly live = Notes.layer.pipe(Layer.provide(Pace.http), Layer.provide(Cache.layer))
}
