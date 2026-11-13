import {
  Code,
  ilostatNotes as dictionaries,
  Country,
  Dimension,
  DimensionId,
  IndicatorId,
  IndicatorNotFound,
  Qualification,
  SourceUnavailable,
  type Observation,
} from "@repo/domain"
import { Context, DateTime, Effect, Layer, Option, Schema, Stream } from "effect"
import { HttpClient } from "effect/http"

import { AssetId, type Adapter, Policy } from "../series/Adapter.ts"
import { Outline } from "../series/Outline.ts"
import { type Stored } from "../series/Store.ts"
import { table } from "../utils/Table.ts"
import surveys from "./assets/ilostat.json" with { type: "json" }

const archive = "SDG_B552_NOC_RT_A"
export const indicator = IndicatorId.make(`ILOSTAT:${archive}`)
export const archiveUrl = `https://rplumber.ilo.org/data/indicator?format=.csv.gz&id=${archive}`
export const tocUrl = "https://rplumber.ilo.org/metadata/toc/indicator?format=.csv&lang=en"
const unavailable = () => new SourceUnavailable({ source: "ILOSTAT" })

// Hex of every UTF-8 byte: reversible and disjoint from native survey syntax.
const encodeSurvey = (raw: string) =>
  Code.make(
    `s${Array.from(new TextEncoder().encode(raw), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
  )

const dimension = Schema.decodeUnknownSync(Dimension)({
  id: DimensionId.make("source"),
  label: "ILO survey/source",
  options: Object.entries(surveys).map(([code, value]) => ({
    code: encodeSurvey(code),
    label: `${code}: ${value.label} (${value.country})`,
  })),
})

export const definition =
  "Female share of senior and middle management positions under the 19th ICLS employment definition, percent (multiplier 0). Not total management. Each survey/source is a separate series; no sex or age dimension is implied. Annual national observations only: quarter/semester/month reference periods and confirmed partial geography are excluded from plotted values, with publisher notes retained. Earlier-definition and working-poverty tables are not included."

export const name = "Female share of senior and middle management, 19th ICLS (%)"
export const dataset = `${archive}; International Labour Organization (ILO), ILOSTAT; CC BY 4.0 https://creativecommons.org/licenses/by/4.0/; https://www.ilo.org/rights-and-permissions; selection: annual national scope and survey/source; format changed, no aggregation`

// The Node reader sorts on disk; Workers never collect an archive.
export class IlostatArchive extends Context.Service<
  IlostatArchive,
  {
    readonly read: (version: string) => Stream.Stream<Stored, SourceUnavailable>
  }
>()("@repo/server/IlostatArchive") {}

// TOC uses day/month/year in Europe/Paris. Its exact timestamp is an opaque
// version, not a US date or a lexical chronological release order.
export const versionOf = Effect.fn("Ilostat.version")(function* (text: string) {
  const rows = yield* table(text)
  const selected = rows.filter((row) => row["id"] === archive)
  const row = selected[0]

  if (
    selected.length !== 1 ||
    row === undefined ||
    row["freq"] !== "A" ||
    row["unit_measure"] !== "PT" ||
    row["unit_mult"] !== "0" ||
    !/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(row["last.update"] ?? "")
  )
    return yield* unavailable()

  return row["last.update"] ?? (yield* unavailable())
})

const Row = Schema.Struct({
  ref_area: Schema.String,
  source: Schema.NonEmptyString,
  indicator: Schema.Literal("SDG_B552_NOC_RT"),
  time: Schema.String,
  obs_value: Schema.String,
  obs_status: Schema.Literals(["", "B", "U"]),
  note_indicator: Schema.String,
  note_source: Schema.String,
})

const numberOf = (cell: string) => {
  if (cell === "") return Effect.succeed(undefined)
  const value = Number(cell)

  return Number.isFinite(value) && /^-?\d+(\.\d+)?$/.test(cell) && value >= 0 && value <= 100
    ? Effect.succeed(value)
    : Effect.fail(unavailable())
}

const observationsOf = (
  qualified: Qualification,
  value: number | undefined,
): Array<Observation> => {
  if (value === undefined || qualified.exclusion !== undefined) return []
  const observation: Observation = { country: qualified.country, year: qualified.year, value }

  if (qualified.status === undefined) return [observation]

  return [
    {
      country: observation.country,
      year: observation.year,
      value,
      flags: [qualified.status.code === "U" ? "Unreliable" : "Break"],
    },
  ]
}

// Decode every publisher code before deciding whether a row is plottable.
export const record = Effect.fn("Ilostat.record")(function* (raw: Record<string, string>) {
  if (Object.keys(raw).some((key) => !Object.hasOwn(Row.fields, key))) return yield* unavailable()
  const row = yield* Schema.decodeUnknownEffect(Row)(raw)

  if (!/^\d{4}$/.test(row.time)) return yield* unavailable()
  const survey = Object.entries(surveys).find(([code]) => code === row.source)?.[1]

  if (survey === undefined || survey.country !== row.ref_area) return yield* unavailable()

  const notes = [
    ...row.note_indicator
      .split("_")
      .filter(Boolean)
      .map((code) => ({ category: "Indicator", code })),
    ...row.note_source
      .split("_")
      .filter(Boolean)
      .map((code) => ({ category: "Source", code })),
  ]

  if (notes.some((note) => noteLabel(note) === "")) return yield* unavailable()

  if (!Schema.is(Country)(row.ref_area))
    return {
      dimensions: { [DimensionId.make("source")]: encodeSurvey(row.source) },
      observations: [],
      qualifications: [],
    }

  const evidence: {
    -readonly [
      K in keyof Omit<Extract<Qualification, { source: "ILOSTAT" }>, "country" | "year" | "notes">
    ]: Extract<Qualification, { source: "ILOSTAT" }>[K]
  } & {
    country: string
    year: number
    notes: Array<{ category: string; code: string; label: string }>
  } = {
    source: "ILOSTAT",
    survey: { code: row.source, label: survey.label },
    series: { indicator, dimensions: { [DimensionId.make("source")]: encodeSurvey(row.source) } },
    country: row.ref_area,
    year: Number(row.time),
    missing: row.obs_value === "",
    notes: notes.map((note) => ({ ...note, label: noteLabel(note) })),
  }

  if (row.obs_status !== "")
    evidence.status = {
      code: row.obs_status,
      label: row.obs_status === "U" ? "Unreliable" : "Break in series",
    }

  if (notes.some(({ code }) => code.startsWith("S4:"))) evidence.exclusion = "Geography"
  else if (notes.some(({ code }) => ["S3:6", "S3:8", "S3:9", "S3:19", "S3:21"].includes(code)))
    evidence.exclusion = "ReferencePeriod"
  const qualified = yield* Schema.decodeUnknownEffect(Qualification)(evidence)

  const value = yield* numberOf(row.obs_value)
  const observations = observationsOf(qualified, value)

  return { dimensions: qualified.series.dimensions, observations, qualifications: [qualified] }
}, Effect.mapError(unavailable))

const noteLabel = ({ category, code }: { readonly category: string; readonly code: string }) =>
  Object.entries(
    category === "Source" ? dictionaries.note_source : dictionaries.note_indicator,
  ).find(([key]) => key === code)?.[1] ?? ""

export class Ilostat extends Context.Service<Ilostat, Adapter>()("@repo/server/Ilostat") {
  static readonly layer = Layer.effect(
    Ilostat,
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
      const transport = yield* Effect.serviceOption(IlostatArchive)

      const version = client.get(tocUrl).pipe(
        Effect.flatMap((response) => response.text),
        Effect.flatMap(versionOf),
        Effect.mapError(unavailable),
      )

      const check = (id: IndicatorId) =>
        id === indicator ? Effect.void : Effect.fail(new IndicatorNotFound({ indicator: id }))

      const adapter: Adapter = {
        policy: Policy.StoredOnly({ url: () => archiveUrl }),
        list: version.pipe(Effect.as([{ indicator, name, definition }])),
        describe: (id) =>
          check(id).pipe(
            Effect.andThen(
              Effect.gen(function* () {
                return {
                  indicator: { id, name, definition },
                  dimensions: [dimension],
                  dataset,
                  retrievedAt: yield* DateTime.now,
                }
              }),
            ),
          ),
        fetch: () => Effect.fail(new SourceUnavailable({ source: "ILOSTAT", reason: "NotStored" })),
        discovery: {
          outlines: Stream.fromEffect(
            version.pipe(
              Effect.andThen(
                Schema.decodeUnknownEffect(Outline)({
                  indicator,
                  annual: true,
                  countries: [
                    ...new Set(Object.values(surveys).map(({ country }) => country)),
                  ].filter(Schema.is(Country)),
                  years: null,
                  dimensions: [
                    {
                      id: dimension.id,
                      codelist: null,
                      codes: dimension.options.map(({ code }) => code),
                      labels: Object.fromEntries(
                        dimension.options.map(({ code, label }) => [code, label]),
                      ),
                    },
                  ],
                }),
              ),
              Effect.mapError(unavailable),
            ),
          ),
        },
        bulk: {
          changed: (entries) =>
            entries.some((entry) => entry.indicator === indicator)
              ? version.pipe(
                  Effect.map((value) => [{ asset: AssetId.make(archive), version: value }]),
                )
              : Effect.succeed([]),
          gather: (asset, options) =>
            asset !== archive || Option.isNone(transport)
              ? Stream.fail(unavailable())
              : Stream.make({ indicator, series: transport.value.read(options.version) }),
        },
      }

      // Only the Node disk reader enrolls this asset. Worker chart/catalog reads
      // keep metadata and StoredOnly behavior without a non-operational mirror.
      if (Option.isNone(transport)) {
        const { bulk: _bulk, ...reader } = adapter

        return Ilostat.of(reader)
      }

      return Ilostat.of(adapter)
    }),
  )
}
