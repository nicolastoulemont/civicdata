import {
  Code,
  Country,
  Dimension,
  DimensionId,
  IndicatorId,
  IndicatorNotFound,
  Observation,
  Qualification,
  Failure,
  SourceUnavailable,
} from "@repo/domain"
import { Context, DateTime, Effect, Layer, Option, Schema, Stream } from "effect"
import { HttpClient } from "effect/http"

import { AssetId, type Adapter, Policy } from "../series/Adapter.ts"
import { unavailable } from "../series/Failure.ts"
import { Outline } from "../series/Outline.ts"
import type { Stored } from "../series/Store.ts"
import areas from "./assets/faostat.json" with { type: "json" }

const indicator = IndicatorId.make("FAOSTAT:AE")

const archiveUrl =
  "https://bulks-faostat.fao.org/production/ASTI_Expenditures_E_All_Data_(Normalized).zip"

const manifestUrl = "https://bulks-faostat.fao.org/production/datasets_E.json"
const name = "Agricultural research spending as a share of agricultural value added (%)"

const definition =
  "ASTI expenditures, measure 8006, percent of agricultural value added in standard local currency (multiplier 0). Government, higher education and private non-profit institutions; private for-profit excluded. Total costs. Actual annual expenditure, not budgets: financial years are assigned to the calendar year covering most of the financial year. No currency or PPP conversion. Other AE measures are not admitted. National areas only; China aggregate and mainland are excluded, never equated with the app's China."

const dataset =
  "FAO. FAOSTAT: ASTI - Expenditures (AE), measure 8006. Licence: CC-BY-4.0; https://www.fao.org/contact-us/terms/db-terms-of-use/en; changes: national annual selection and format, no aggregation or conversion"

// An answer we cannot read: not the manifest, archive or rows we reviewed.
const unreadable = () =>
  new SourceUnavailable({ source: "FAOSTAT", failure: Failure.cases.Unreadable.make({}) })

const dimensions = Schema.decodeUnknownSync(Schema.Array(Dimension))([
  {
    id: "measure",
    label: "Indicator and unit",
    options: [
      {
        code: "8006",
        label:
          "Expenditure in Agricultural R&D as Share of Agricultural Value Added (Standard Local Currency), %",
      },
    ],
  },
  { id: "cost", label: "Cost category", options: [{ code: "300", label: "Total" }] },
  {
    id: "institution",
    label: "Institution",
    options: [{ code: "200", label: "Government, Higher Education and Private Non-profit" }],
  },
])

const selected = {
  [DimensionId.make("measure")]: Code.make("8006"),
  [DimensionId.make("cost")]: Code.make("300"),
  [DimensionId.make("institution")]: Code.make("200"),
}

const flags = {
  A: "Official figure",
  B: "Time series break",
  E: "Estimated value",
  I: "Value imputed by a receiving agency",
  X: "Figure from external organization",
}

const Manifest = Schema.Struct({
  Datasets: Schema.Struct({
    Dataset: Schema.Array(
      Schema.Struct({
        DatasetCode: Schema.String,
        DateUpdate: Schema.NonEmptyString,
        FileLocation: Schema.String,
        FileRows: Schema.Int,
      }),
    ),
  }),
})

const versionOf = Effect.fn("Faostat.version")(function* (text: string) {
  const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest))(text)
  const rows = manifest.Datasets.Dataset.filter((row) => row.DatasetCode === "AE")
  const row = rows[0]

  if (
    rows.length !== 1 ||
    row === undefined ||
    row.FileLocation !== archiveUrl ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(row.DateUpdate) ||
    row.FileRows <= 0
  )
    return yield* unreadable()

  // Include membership count as well as the publisher's opaque update timestamp.
  return `${row.DateUpdate}/${row.FileRows}`
}, Effect.mapError(unreadable))

const Row = Schema.Struct({
  "Area Code": Schema.String,
  "Area Code (M49)": Schema.String,
  Area: Schema.String,
  "Indicator Code": Schema.String,
  Indicator: Schema.String,
  "Cost Category Code": Schema.Literal("300"),
  "Cost Category": Schema.Literal("Total"),
  "Institution Code": Schema.Literal("200"),
  Institution: Schema.Literal("Government, Higher Education and Private Non-profit"),
  "Year Code": Schema.String,
  Year: Schema.String,
  Unit: Schema.String,
  Value: Schema.String,
  Flag: Schema.String,
  Note: Schema.String,
}).check(Schema.makeFilter((row) => row.Year === row["Year Code"]))

const numberOf = (text: string) => {
  const value = Number(text)

  return text === "" || (/^-?\d+(\.\d+)?$/.test(text) && Number.isFinite(value) && value >= 0)
    ? Effect.succeed(value)
    : Effect.fail(unreadable())
}

const currentVersion = (client: HttpClient.HttpClient) =>
  client.get(manifestUrl).pipe(
    Effect.flatMap((response) => response.text),
    Effect.timeout("1 minute"),
    unavailable("FAOSTAT", manifestUrl),
    Effect.flatMap(versionOf),
  )

interface Point {
  country: Country
  year: number
  value: number
  flags?: ["Break" | "Estimated"]
}

interface Evidence {
  source: "FAOSTAT"
  series: { indicator: IndicatorId; dimensions: typeof selected }
  country: Country
  year: number
  missing: boolean
  notes: Array<{ category: "Note"; code: "Note"; label: string }>
  status?: { code: string; label: string }
}

const notesOf = (text: string): Evidence["notes"] =>
  text === "" ? [] : [{ category: "Note", code: "Note", label: text }]

const statusOf = (code: string): Evidence["status"] =>
  code === ""
    ? undefined
    : {
        code,
        label:
          Object.entries(flags).find(([key]) => key === code)?.[1] ?? "Unrecognized publisher flag",
      }

const record = Effect.fn("Faostat.record")(function* (raw: Record<string, string>) {
  if (Object.keys(raw).some((key) => !Object.hasOwn(Row.fields, key))) return yield* unreadable()
  const row = yield* Schema.decodeUnknownEffect(Row)(raw)
  const area = yield* areaOf(row)

  if (row["Indicator Code"] !== "8006") return undefined

  if (
    row.Indicator !==
      "Expenditure in Agricultural R&D as Share of Agricultural Value Added (Standard Local Currency)" ||
    row.Unit !== "%"
  )
    return yield* unreadable()

  if (!/^\d{4}$/.test(row.Year)) return undefined

  if (!Schema.is(Country)(area.country)) return undefined
  const missing = row.Value === ""
  const value = yield* numberOf(row.Value)

  const evidence: Evidence = {
    source: "FAOSTAT",
    series: { indicator, dimensions: selected },
    country: area.country,
    year: Number(row.Year),
    missing,
    notes: notesOf(row.Note),
  }

  const status = statusOf(row.Flag)

  if (status !== undefined) evidence.status = status

  const qualification = yield* Schema.decodeUnknownEffect(Qualification)(evidence)
  const observations = yield* observationsOf(qualification, value)

  return { dimensions: selected, observations, qualifications: [qualification] }
}, Effect.mapError(unreadable))

const observationsOf = Effect.fn("Faostat.observations")(function* (
  qualification: Qualification,
  value: number,
) {
  const observations: Array<Observation> = []

  if (!qualification.missing) {
    const observation: Point = {
      country: qualification.country,
      year: qualification.year,
      value,
    }

    if (qualification.status?.code === "B") observation.flags = ["Break"]

    if (qualification.status?.code === "E") observation.flags = ["Estimated"]
    observations.push(yield* Schema.decodeUnknownEffect(Observation)(observation))
  }

  return observations
})

export class FaostatArchive extends Context.Service<
  FaostatArchive,
  { readonly read: (version: string) => Stream.Stream<Stored, SourceUnavailable> }
>()("@repo/server/FaostatArchive") {}

export class Faostat extends Context.Service<Faostat, Adapter>()("@repo/server/Faostat") {
  static readonly layer = Layer.effect(
    Faostat,
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
      const transport = yield* Effect.serviceOption(FaostatArchive)

      const version = currentVersion(client)

      const metadata = { indicator: { id: indicator, name, definition }, dimensions, dataset }

      const describe = (id: IndicatorId) =>
        id !== indicator
          ? Effect.fail(new IndicatorNotFound({ indicator: id }))
          : DateTime.now.pipe(Effect.map((retrievedAt) => ({ ...metadata, retrievedAt })))

      const adapter: Adapter = {
        policy: Policy.StoredOnly({ url: () => archiveUrl }),
        list: Effect.succeed([{ indicator, name, definition }]),
        describe,
        fetch: () => Effect.fail(new SourceUnavailable({ source: "FAOSTAT", reason: "NotStored" })),
        discovery: {
          outlines: Stream.make(
            Outline.make({
              indicator,
              annual: true,
              // The area's dictionary is a code map, not measure coverage.
              countries: null,
              years: null,
              dimensions: dimensions.map((dimension) => ({
                id: dimension.id,
                codelist: null,
                codes: [
                  dimension.options[0].code,
                  ...dimension.options.slice(1).map((option) => option.code),
                ],
                labels: Object.fromEntries(
                  dimension.options.map((option) => [option.code, option.label]),
                ),
              })),
            }),
          ),
        },
      }

      if (Option.isNone(transport)) return Faostat.of(adapter)
      const disk = transport.value

      return Faostat.of({
        ...adapter,
        bulk: {
          changed: (entries) =>
            entries.some((entry) => entry.indicator === indicator)
              ? version.pipe(Effect.map((value) => [{ asset: AssetId.make("AE"), version: value }]))
              : Effect.succeed([]),
          gather: (asset, options) =>
            asset !== "AE"
              ? Stream.fail(unreadable())
              : Stream.make({ indicator, series: disk.read(options.version) }),
        },
      })
    }),
  )
}

const areaOf = Effect.fn("Faostat.area")(function* (row: typeof Row.Type) {
  const area = Object.entries(areas).find(([code]) => code === row["Area Code"])?.[1]

  if (
    area === undefined ||
    area.m49 !== row["Area Code (M49)"] ||
    area.label.replaceAll(";", ",") !== row.Area
  )
    return yield* unreadable()

  return area
})

export const asti = {
  indicator,
  archiveUrl,
  manifestUrl,
  name,
  definition,
  dataset,
  record,
  versionOf,
  currentVersion,
}
