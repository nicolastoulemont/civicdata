import { Country, Dimension, IndicatorId, IndicatorNotFound, SourceUnavailable } from "@repo/domain"
import { Context, DateTime, Effect, Layer, Option, Schema, Stream } from "effect"

import { type Adapter, Policy, type Release } from "../series/Adapter.ts"
import { Outline } from "../series/Outlines.ts"
import { type Stored } from "../series/Store.ts"

const indicator = IndicatorId.make("WID:sptinc992j")
const name = "Pre-tax national income share (equal-split adults, fraction)"

const definition =
  "WID pre-tax national income, after pension distributions but before other taxes and transfers. Individuals over age 20; resources split equally within couples. Native fractions (0–1), without percent conversion. Explicit bottom 50% or top 10% percentile. Reviewed national units: France (FR) and Sweden (SE), 1991–2024. Publisher estimates, including interpolation and extensions; yearly quality grades and country method notes accompany the values."

const dataset =
  "World Inequality Database (WID.world), sptinc992j. Noncommercial open-source reuse; https://wid.world/data/ . Selection and format only."

const units = [
  { native: "FR", country: Country.make("FRA"), name: "France" },
  { native: "SE", country: Country.make("SWE"), name: "Sweden" },
]

const dimensions = Schema.decodeUnknownSync(Schema.Array(Dimension))([
  {
    id: "percentile",
    label: "Percentile",
    options: [
      { code: "p0p50", label: "Bottom 50%" },
      { code: "p90p100", label: "Top 10%" },
    ],
  },
  { id: "age", label: "Age", options: [{ code: "992", label: "Adults over age 20" }] },
  { id: "population", label: "Population", options: [{ code: "j", label: "Equal-split adults" }] },
  { id: "unit", label: "Unit", options: [{ code: "share", label: "Fraction (0–1)" }] },
])

const selection = (percentile: string) => ({
  percentile,
  age: "992",
  population: "j",
  unit: "share",
})

export class WidArchive extends Context.Service<
  WidArchive,
  {
    readonly release: Effect.Effect<Release, SourceUnavailable>
    readonly read: (version: string) => Stream.Stream<Stored, SourceUnavailable>
    readonly verify: (version: string) => Effect.Effect<void, SourceUnavailable>
  }
>()("@repo/server/WidArchive") {}

export class Wid extends Context.Service<Wid, Adapter>()("@repo/server/Wid") {
  static readonly layer = Layer.effect(
    Wid,
    Effect.gen(function* () {
      const archive = yield* Effect.serviceOption(WidArchive)

      const adapter: Adapter = {
        policy: Policy.StoredOnly({ url: () => "https://wid.world/data/" }),
        coherent: true,
        list: Effect.succeed([{ indicator, name, definition }]),
        describe: Effect.fn("Wid.describe")(function* (id) {
          if (id !== indicator) return yield* new IndicatorNotFound({ indicator: id })

          return {
            indicator: { id, name, definition },
            dataset,
            dimensions,
            retrievedAt: yield* DateTime.now,
          }
        }),
        fetch: () => Effect.fail(new SourceUnavailable({ source: "WID", reason: "NotStored" })),
        discovery: {
          outlines: Stream.make(
            Outline.make({
              indicator,
              dimensions: dimensions.map(({ id, options }) => ({
                id,
                codelist: null,
                codes: [options[0].code, ...options.slice(1).map(({ code }) => code)],
                labels: Object.fromEntries(options.map(({ code, label }) => [code, label])),
              })),
              annual: true,
              countries: null,
              years: null,
            }),
          ),
        },
      }

      if (Option.isNone(archive)) return Wid.of(adapter)

      return Wid.of({
        ...adapter,
        bulk: {
          release: (entries) =>
            entries.length === 1 && entries[0]?.indicator === indicator
              ? archive.value.release
              : Effect.fail(new SourceUnavailable({ source: "WID" })),
          verify: archive.value.verify,
          gather: (asset, { version }) =>
            asset === "countries"
              ? Stream.make({ indicator, series: archive.value.read(version) })
              : Stream.fail(new SourceUnavailable({ source: "WID" })),
        },
      })
    }),
  )
}

export const income = { indicator, name, definition, dataset, units, dimensions, selection }
