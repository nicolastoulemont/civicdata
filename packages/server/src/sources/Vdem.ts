import {
  Country,
  IndicatorId,
  IndicatorNotFound,
  Observation,
  Qualification,
  SourceUnavailable,
} from "@repo/domain"
import { Context, DateTime, Effect, Layer, Option, Schema, Stream } from "effect"

import { AssetId, Release } from "../series/Adapter.schemas.ts"
import { type Adapter, Policy } from "../series/Adapter.types.ts"
import { Outline } from "../series/Outline.schemas.ts"
import type { Stored } from "../series/Store.schemas.ts"

const indicator = IndicatorId.make("V-Dem:v2x_polyarchy")
const commit = "f4dd26922e658442524dfd954bf14f7ebe622d5d"
const sha256 = "39b412d39a061c18f20c98e4ad4d6355b05a0441df31be4ee9aec420dc3d95ea"
const version = `V16/${commit}/${sha256}`
const archiveUrl = `https://raw.githubusercontent.com/vdeminstitute/vdemdata/${commit}/data/vdem.RData`
const name = "Electoral democracy index (V-Dem estimate, 0–1)"

const definition =
  "V-Dem v16 electoral democracy: suffrage, elected officials, clean elections, freedom of association and freedom of expression. Publisher annual day-weighted index, low to high (0–1), with published 68% highest posterior density (HPD) intervals. Estimates, not observed counts. Reviewed scope: France (European possessions only, excluding overseas departments and territories) and Sweden, 1991–2025 only. No historical continuity inferred. Compare only within this release; releases 1–5 used a different aggregation formula."

const dataset =
  "Coppedge et al. (2026). V-Dem Country-Year Dataset v16. https://doi.org/10.23696/vdemds26; Teorell et al. (2019); V-Dem Codebook v16 §§1.4.3, 1.5.1, 2.1.1. CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0/; changes: country/year/column selection and format only, no calculation."

const unavailable = () => new SourceUnavailable({ source: "V-Dem" })

// Reviewed identities, not an ISO join. Every other unit and earlier period is excluded.
const units: ReadonlyArray<{ id: number; code: Country; name: string }> = [
  { id: 76, code: "FRA", name: "France" },
  { id: 5, code: "SWE", name: "Sweden" },
]

const Row = Schema.Struct({
  country_name: Schema.NonEmptyString,
  country_text_id: Schema.NonEmptyString,
  country_id: Schema.Int,
  year: Schema.Int,
  v2x_polyarchy: Schema.NullOr(Schema.Finite),
  v2x_polyarchy_codelow: Schema.NullOr(Schema.Finite),
  v2x_polyarchy_codehigh: Schema.NullOr(Schema.Finite),
})

const record = Effect.fn("Vdem.record")(function* (raw: Record<string, string | number | null>) {
  const row = yield* Schema.decodeUnknownEffect(Row)(raw)
  const unit = units.find((item) => item.id === row.country_id)

  if (unit === undefined) return undefined

  if (unit.code !== row.country_text_id || unit.name !== row.country_name)
    return yield* unavailable()

  if (row.year < 1991 || row.year > 2025) return undefined

  const qualification = yield* Schema.decodeUnknownEffect(Qualification)({
    source: "V-Dem",
    series: { indicator, dimensions: {} },
    country: row.country_text_id,
    year: row.year,
    missing: row.v2x_polyarchy === null,
    version,
    evidence: { commit, sha256 },
    estimate: row.v2x_polyarchy,
    interval:
      row.v2x_polyarchy_codelow === null && row.v2x_polyarchy_codehigh === null
        ? null
        : {
            lower: row.v2x_polyarchy_codelow,
            upper: row.v2x_polyarchy_codehigh,
            level: 0.68,
            method: "HPD",
            lowerField: "v2x_polyarchy_codelow",
            upperField: "v2x_polyarchy_codehigh",
            codebook: "https://v-dem.net/documents/70/codebook_v16.pdf",
          },
    notes: [
      {
        category: "Method",
        code: "countryunit_v16",
        label:
          unit.code === "FRA"
            ? "France: European possessions only; excludes overseas departments and territories (V16 country units §5.5.6)."
            : "Sweden: excludes Saint Barthélemy (V16 country units §5.3.5).",
      },
      {
        category: "Method",
        code: "v16",
        label:
          "Annual day-weighted index; 68% HPD from posterior samples. Compare within v16 only. Releases 1–5 used a preliminary aggregation formula.",
      },
    ],
  })

  const observations = yield* observationsOf(qualification)

  return { dimensions: {}, observations, qualifications: [qualification] }
}, Effect.mapError(unavailable))

const observationsOf = Effect.fn("Vdem.observations")(function* (item: Qualification) {
  if (item.source !== "V-Dem" || item.estimate === null) return []

  return [
    yield* Schema.decodeUnknownEffect(Observation)({
      country: item.country,
      year: item.year,
      value: item.estimate,
      flags: ["Estimated"],
    }),
  ]
})

const release = Release.make({
  version,
  order: 16,
  assets: [{ asset: AssetId.make("country-year"), members: [{ indicator, dimensions: {} }] }],
})

export class VdemArchive extends Context.Service<
  VdemArchive,
  {
    readonly read: Stream.Stream<Stored, SourceUnavailable>
  }
>()("@repo/server/VdemArchive") {}

export class Vdem extends Context.Service<Vdem, Adapter>()("@repo/server/Vdem") {
  static readonly layer = Layer.effect(
    Vdem,
    Effect.gen(function* () {
      const transport = yield* Effect.serviceOption(VdemArchive)

      const adapter: Adapter = {
        coherent: true,
        policy: Policy.StoredOnly({
          url: (_query, storedVersion) =>
            `https://raw.githubusercontent.com/vdeminstitute/vdemdata/${storedVersion.split("/")[1]}/data/vdem.RData`,
        }),
        list: Effect.succeed([{ indicator, name, definition }]),
        describe: (id) =>
          id !== indicator
            ? Effect.fail(new IndicatorNotFound({ indicator: id }))
            : DateTime.now.pipe(
                Effect.map((retrievedAt) => ({
                  indicator: { id, name, definition },
                  dimensions: [],
                  dataset,
                  retrievedAt,
                })),
              ),
        fetch: () => Effect.fail(new SourceUnavailable({ source: "V-Dem", reason: "NotStored" })),
        discovery: {
          outlines: Stream.make(
            Outline.make({
              indicator,
              dimensions: [],
              annual: true,
              countries: units.map((unit) => Country.make(unit.code)),
              years: { first: 1991, last: 2025 },
            }),
          ),
        },
      }

      if (Option.isNone(transport)) return Vdem.of(adapter)

      return Vdem.of({
        ...adapter,
        bulk: {
          release: (entries) =>
            entries.length === 1 && entries[0]?.indicator === indicator
              ? Effect.succeed(release)
              : Effect.fail(unavailable()),
          gather: (asset, options) =>
            asset !== "country-year" || options.version !== version
              ? Stream.fail(unavailable())
              : Stream.make({ indicator, series: transport.value.read }),
        },
      })
    }),
  )
}

export const polyarchy = {
  indicator,
  commit,
  sha256,
  version,
  archiveUrl,
  name,
  definition,
  dataset,
  record,
  row: Row,
  release,
}
