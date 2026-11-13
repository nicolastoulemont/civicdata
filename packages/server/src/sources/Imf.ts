import { Country, Dimension, IndicatorId, IndicatorNotFound, SourceUnavailable } from "@repo/domain"
import { Context, DateTime, Effect, Layer, Option, Schema, Stream } from "effect"

import { type Adapter, Policy, type Release } from "../series/Adapter.ts"
import { Outline } from "../series/Outlines.ts"
import { type Stored } from "../series/Store.ts"

const indicator = IndicatorId.make("IMF:NGDP_RPCH")
const name = "Gross domestic product (GDP), Constant prices, Percent change"

const definition =
  "WEO real GDP annual growth, percent (not fraction), scale 0, constant prices. Reviewed IMF national units France and Sweden, 2020–2030. Publisher-designated actuals can be revised; later years are IMF staff estimates/projections, without a finer split. Explicit publication vintage and country metadata accompany every year. No aggregates or other indicators."

const dataset =
  "International Monetary Fund, World Economic Outlook (WEO). Source: IMF. https://data.imf.org/en/datasets/IMF.RES:WEO . © IMF. Reuse subject to https://www.imf.org/en/about/copyright-and-terms ; third-party rights retained."

const units = [Country.make("FRA"), Country.make("SWE")]

const dimensions = Schema.decodeUnknownSync(Schema.Array(Dimension))([
  { id: "FREQUENCY", label: "Frequency", options: [{ code: "A", label: "Annual" }] },
  { id: "UNIT", label: "Unit", options: [{ code: "PT", label: "Percent" }] },
  { id: "PRICES", label: "Prices", options: [{ code: "Q", label: "Constant prices" }] },
])

const selection = { FREQUENCY: "A", UNIT: "PT", PRICES: "Q" }

export class ImfArchive extends Context.Service<
  ImfArchive,
  {
    readonly release: Effect.Effect<Release, SourceUnavailable>
    readonly read: (version: string) => Stream.Stream<Stored, SourceUnavailable>
    readonly verify: (version: string) => Effect.Effect<void, SourceUnavailable>
  }
>()("@repo/server/ImfArchive") {}

export class Imf extends Context.Service<Imf, Adapter>()("@repo/server/Imf") {
  static readonly layer = Layer.effect(
    Imf,
    Effect.gen(function* () {
      const archive = yield* Effect.serviceOption(ImfArchive)

      const entry = { indicator, name, definition }

      const described = Effect.gen(function* () {
        return {
          indicator: { id: indicator, name, definition },
          dataset,
          dimensions,
          retrievedAt: yield* DateTime.now,
        }
      })

      const adapter: Adapter = {
        coherent: true,
        policy: Policy.StoredOnly({ url: () => "https://data.imf.org/en/datasets/IMF.RES:WEO" }),
        list: Effect.succeed([entry]),
        describe: (id) =>
          id === indicator ? described : Effect.fail(new IndicatorNotFound({ indicator: id })),
        fetch: () => Effect.fail(new SourceUnavailable({ source: "IMF", reason: "NotStored" })),
        discovery: {
          outlines: Stream.make(
            Outline.make({
              indicator,
              annual: true,
              countries: null,
              years: null,
              dimensions: dimensions.map((dimension) => ({
                id: dimension.id,
                codelist: null,
                codes: [dimension.options[0].code],
                labels: { [dimension.options[0].code]: dimension.options[0].label },
              })),
            }),
          ),
        },
      }

      if (Option.isNone(archive)) return Imf.of(adapter)

      return Imf.of({
        ...adapter,
        bulk: {
          release: Effect.fn("Imf.release")(function* (entries) {
            const [requested, ...rest] = entries

            if (requested?.indicator !== indicator || rest.length !== 0)
              return yield* new SourceUnavailable({ source: "IMF" })

            return yield* archive.value.release
          }),
          verify: archive.value.verify,
          gather: (asset, { version }) =>
            asset === "countries"
              ? Stream.make({ indicator, series: archive.value.read(version) })
              : Stream.fail(new SourceUnavailable({ source: "IMF" })),
        },
      })
    }),
  )
}

export const growth = { indicator, name, definition, dataset, units, dimensions, selection }
