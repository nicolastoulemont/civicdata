import { Country, Observation, Qualification } from "@openfacts/domain"
import { Effect, Schema } from "effect"

import { income } from "../src/Wid.ts"

const quality = [
  "Imputed regional average",
  "Carry forward or backward",
  "Interpolation",
  "Only one type of source: survey data or tax data",
  "Tax and survey data",
  "Tax and survey microdata",
]

const Row = Schema.Struct({
  year: Schema.FiniteFromString.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 1991, maximum: 2024 }),
  ),
  value: Schema.String,
  data_quality: Schema.String.check(Schema.isPattern(/^[0-5]?$/)),
})

const Value = Schema.FiniteFromString.check(Schema.isBetween({ minimum: 0, maximum: 1 }))

export const metadata = Schema.Struct({
  countryname: Schema.NonEmptyString,
  unit: Schema.Literal("share"),
  shorttype: Schema.Literal("Share"),
  shortpop: Schema.Literal("equal-split adults"),
  shortage: Schema.Literal("Adults"),
  longage: Schema.Literal("The population is comprised of individuals over age 20."),
  longpop: Schema.Literal(
    "The base unit is the individual (rather than the household) but resources are split equally within couples.",
  ),
  source: Schema.NonEmptyString,
  method: Schema.NonEmptyString,
})

export const record = Effect.fn("Wid.record")(function* (
  raw: Record<string, string>,
  options: { country: Country; percentile: string; metadata: typeof metadata.Type },
) {
  const row = yield* Schema.decodeUnknownEffect(Row)(raw)
  const missing = row.value === "" || row.value === "NA"
  const observations: Array<Observation> = []

  if (!missing)
    observations.push(
      yield* Schema.decodeUnknownEffect(Observation)({
        country: options.country,
        year: row.year,
        value: yield* Schema.decodeEffect(Value)(row.value),
      }),
    )

  const status =
    row.data_quality === ""
      ? undefined
      : { code: row.data_quality, label: quality[Number(row.data_quality)] }

  const qualification = {
    source: "WID",
    series: { indicator: income.indicator, dimensions: income.selection(options.percentile) },
    country: options.country,
    year: row.year,
    missing,
    notes: [
      { category: "Source", code: "source", label: options.metadata.source },
      { category: "Method", code: "method", label: options.metadata.method },
      { category: "Quality", code: "data_quality", label: "https://wid.world/data-quality/" },
    ],
  }

  const qualified = status === undefined ? qualification : { ...qualification, status }

  return {
    observations,
    qualification: yield* Schema.decodeUnknownEffect(Qualification)(qualified),
  }
})
