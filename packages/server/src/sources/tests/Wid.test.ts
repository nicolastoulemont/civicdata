import { expect, it } from "@effect/vitest"
import { Code, DimensionsMissing, IndicatorId, SourceUnavailable, Year } from "@repo/domain"
import { Effect, Layer, Stream } from "effect"

import { Releases } from "../../series/Releases.ts"
import { Store } from "../../series/Store.ts"
import { Sources } from "../Sources.ts"
import { income, Wid } from "../Wid.ts"

const { indicator, dimensions, selection } = income

const registry = Layer.effect(
  Sources,
  Effect.gen(function* () {
    const adapter = yield* Wid

    return Sources.of({ "World Bank": adapter, Eurostat: adapter, OECD: adapter, WID: adapter })
  }),
).pipe(Layer.provide(Wid.layer))

const reads = Sources.stored.pipe(
  Layer.provide(registry),
  Layer.provide(Store.none),
  Layer.provide(Releases.none),
)

it.effect(
  "offers every WID dimension, returns typed stored misses and never enrolls a Worker archive",
  () =>
    Effect.gen(function* () {
      const sources = yield* Sources
      const adapter = yield* Sources.get(sources, indicator)

      const query = {
        indicator,
        countries: ["FRA" as const],
        from: Year.make(1991),
        to: Year.make(2024),
        dimensions: selection("p0p50"),
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
        new SourceUnavailable({ source: "WID", reason: "NotStored" }),
      )
      expect(adapter.bulk).toBeUndefined()
      expect(
        yield* adapter.describe(IndicatorId.make("WID:other")).pipe(Effect.flip),
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
        from: Year.make(1991),
        to: Year.make(2024),
        dimensions: selection("p0p50"),
      })
      .pipe(
        Effect.flip,
        Effect.tap((error) =>
          Effect.sync(() => expect(error).toHaveProperty("reason", "StoreUnavailable")),
        ),
      )
  }).pipe(Effect.provide(Sources.stored.pipe(Layer.provide(registry), Layer.provide(Store.none)))),
)
