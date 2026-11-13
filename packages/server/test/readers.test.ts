import { beforeEach, describe, expect, it } from "@effect/vitest"
import { CatalogUnavailable, Country, IndicatorId, PoliticsUnavailable, Year } from "@repo/domain"
import { reset } from "cloudflare:test"
import { Cause, Effect, Exit, Layer } from "effect"

import { Catalog } from "../src/Catalog.ts"
import { CatalogBuild, Step } from "../src/CatalogBuild.ts"
import { Classifier } from "../src/Classifier.ts"
import { Directions } from "../src/Directions.ts"
import { Gather } from "../src/Gather.ts"
import { Politics } from "../src/Politics.ts"
import { PoliticsBuild } from "../src/PoliticsBuild.ts"
import { build, catalogOver, listings } from "./catalog.ts"
import { schema, snapshot } from "./tables.ts"

// The readers as the Worker builds them, over its CATALOG_DB binding.
// Political records have a test of their own in Politics.test.ts.
const readers = Layer.mergeAll(Catalog.live, Politics.live, Directions.live)

beforeEach(() => reset())

const died = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) && Cause.hasDies(exit.cause)

describe("readers of the catalog's database", () => {
  it.effect("answer unavailable and create no table before a build", () =>
    Effect.gen(function* () {
      const search = yield* (yield* Catalog).search("population").pipe(Effect.flip)

      const records = yield* (yield* Politics)
        .records({ countries: [Country.make("ESP")], from: Year.make(2000), to: Year.make(2020) })
        .pipe(Effect.flip)

      const direction = yield* (yield* Directions).of(IndicatorId.make("SP.POP.TOTL"))

      expect(search).toBeInstanceOf(CatalogUnavailable)
      expect(records).toBeInstanceOf(PoliticsUnavailable)
      expect(direction).toBe("Neutral")
      expect(yield* schema).toEqual([])
    }).pipe(Effect.provide(readers)),
  )

  it.effect("write nothing to a catalog a build filled", () =>
    Effect.gen(function* () {
      yield* build(1).pipe(Effect.provide(catalogOver(listings())))

      const before = yield* snapshot
      const found = yield* (yield* Catalog).search("population")

      expect(found).not.toEqual([])
      expect(yield* (yield* Directions).of(IndicatorId.make("SP.POP.TOTL"))).toBe("Neutral")
      expect(yield* snapshot).toEqual(before)
    }).pipe(Effect.provide(readers)),
  )
})

describe("builds", () => {
  it.effect("create the catalog's tables", () =>
    Effect.gen(function* () {
      yield* build(1).pipe(Effect.provide(catalogOver(listings())))

      expect((yield* schema).map(({ name }) => name)).toEqual(
        expect.arrayContaining(["catalog", "catalog_current", "catalog_direction"]),
      )
    }),
  )

  // The test Worker binds no Workflow, as a preview reading production's
  // catalog binds none.
  it.effect("stop before writing on a Worker that binds no Workflow", () =>
    Effect.gen(function* () {
      const exits = yield* Effect.all([
        CatalogBuild.run({ id: "build 1", generation: 1 }).pipe(
          Effect.provide([CatalogBuild.live.pipe(Layer.provide(Classifier.off)), Step.immediate]),
          Effect.exit,
        ),
        PoliticsBuild.run(1).pipe(
          Effect.provide([PoliticsBuild.live, Step.immediate]),
          Effect.exit,
        ),
        Gather.run().pipe(Effect.provide([Gather.live, Step.immediate]), Effect.exit),
      ])

      expect(exits.map(died)).toEqual([true, true, true])

      expect(yield* schema).toEqual([])
    }),
  )
})
