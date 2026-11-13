import { expect, it } from "@effect/vitest"
import { Code, DimensionsMissing, IndicatorId, SourceUnavailable, Year } from "@repo/domain"
import { Effect, Layer, Stream } from "effect"

import { growth, Imf } from "../src/Imf.ts"
import { Releases } from "../src/Releases.ts"
import { Sources } from "../src/Sources.ts"
import { Store } from "../src/Store.ts"

const { indicator, dimensions, selection } = growth

const registry = Layer.effect(
  Sources,
  Effect.gen(function* () {
    const adapter = yield* Imf

    return Sources.of({ "World Bank": adapter, Eurostat: adapter, OECD: adapter, IMF: adapter })
  }),
).pipe(Layer.provide(Imf.layer))

const reads = Sources.stored.pipe(
  Layer.provide(registry),
  Layer.provide(Store.none),
  Layer.provide(Releases.none),
)

it.effect(
  "offers every IMF dimension, returns typed stored misses and never enrolls a Worker archive",
  () =>
    Effect.gen(function* () {
      const sources = yield* Sources
      const adapter = yield* Sources.get(sources, indicator)

      const query = {
        indicator,
        countries: ["FRA" as const],
        from: Year.make(2020),
        to: Year.make(2030),
        dimensions: selection,
      }

      for (const picked of [
        {},
        { ...query.dimensions, unit: Code.make("percent") },
        { ...query.dimensions, extra: Code.make("x") },
      ]) {
        const error = yield* adapter.fetch({ ...query, dimensions: picked }).pipe(Effect.flip)
        expect(error).toBeInstanceOf(DimensionsMissing)
        expect(error).toHaveProperty("dimensions", dimensions)
      }

      expect(yield* adapter.fetch(query).pipe(Effect.flip)).toEqual(
        new SourceUnavailable({ source: "IMF", reason: "NotStored" }),
      )
      expect(adapter.bulk).toBeUndefined()
      expect(
        yield* adapter.describe(IndicatorId.make("IMF:other")).pipe(Effect.flip),
      ).toHaveProperty("_tag", "IndicatorNotFound")
      expect(yield* Stream.runCollect(adapter.discovery?.outlines ?? Stream.empty)).toMatchObject([
        { countries: null, years: null },
      ])
    }).pipe(Effect.provide(reads)),
)

it.effect("retains the typed store failure channel", () =>
  Effect.gen(function* () {
    const sources = yield* Sources
    const adapter = yield* Sources.get(sources, indicator)

    return yield* adapter
      .fetch({
        indicator,
        countries: ["FRA"],
        from: Year.make(2020),
        to: Year.make(2030),
        dimensions: selection,
      })
      .pipe(
        Effect.flip,
        Effect.tap((error) =>
          Effect.sync(() => expect(error).toHaveProperty("reason", "StoreUnavailable")),
        ),
      )
  }).pipe(Effect.provide(Sources.stored.pipe(Layer.provide(registry), Layer.provide(Store.none)))),
)
