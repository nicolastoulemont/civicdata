import { Country, Year, Qualification, SourceUnavailable } from "@openfacts/domain"
import { Effect, Schema } from "effect"

import { growth } from "../src/Imf.ts"
import { Stored } from "../src/Store.ts"
import { table } from "../src/Table.ts"

const YearFromString = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 2020, maximum: 2030 }),
)

const unavailable = () => new SourceUnavailable({ source: "IMF" })

export const record = Effect.fn("Imf.record")(function* (
  text: string,
  options: { country: Country; vintage: string },
) {
  const { country, vintage } = options
  const { indicator, name, selection } = growth
  const rows = yield* table(text)

  if (rows.length !== 11 || new Set(rows.map((row) => row["TIME_PERIOD"])).size !== 11)
    return yield* unavailable()
  const qualifications: Array<Qualification> = []
  const observations: Array<(typeof Stored.Type.observations)[number]> = []

  for (const row of rows) {
    const expected = {
      DATAFLOW: "IMF.RES:WEO(9.0.0)",
      COUNTRY: country,
      INDICATOR: "NGDP_RPCH",
      FREQUENCY: "A",
      UNIT: "PT",
      PRICES: "Q",
      SCALE: "0",
      PUBLICATION_DATE: vintage,
      UPDATE_DATE: vintage,
      SERIES_NAME: name,
    }

    if (Object.entries(expected).some(([key, value]) => row[key] !== value))
      return yield* unavailable()

    const year = yield* Schema.decodeUnknownEffect(YearFromString)(row["TIME_PERIOD"])

    const latestActual = yield* Schema.decodeUnknownEffect(Schema.NumberFromString)(
      row["LATEST_ACTUAL_ANNUAL_DATA"],
    )

    const raw = row["OBS_VALUE"]

    if (raw === undefined) return yield* unavailable()
    const missing = raw === ""

    if (!missing && !/^-?\d+(?:\.\d+)?$/.test(raw)) return yield* unavailable()

    if (!missing)
      observations.push({
        country,
        year: Year.make(year),
        value: yield* Schema.decodeUnknownEffect(Schema.NumberFromString.check(Schema.isFinite()))(
          raw,
        ),
      })
    qualifications.push(
      yield* Schema.decodeUnknownEffect(Qualification)({
        source: "IMF",
        series: { indicator, dimensions: selection },
        country,
        year,
        missing,
        vintage,
        latestActual,
        status:
          year <= latestActual
            ? { code: "Actual", label: "Publisher-designated actual (revisable)" }
            : { code: "EstimateProjection", label: "IMF staff estimate/projection" },
        notes: Object.entries(row)
          .filter(
            ([code, label]) =>
              label !== "" && !["COUNTRY", "INDICATOR", "TIME_PERIOD", "OBS_VALUE"].includes(code),
          )
          .map(([code, label]) => ({ category: "Publisher", code, label })),
      }),
    )
  }

  return { observations, qualifications }
})
