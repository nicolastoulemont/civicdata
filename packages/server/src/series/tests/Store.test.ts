import { beforeEach, describe, expect, it } from "@effect/vitest"
import { countries, Dimensions, IndicatorId, Year } from "@repo/domain"
import { reset } from "cloudflare:test"
import { DateTime, Effect, Exit, Option, Schema, Stream } from "effect"

import { record, indicator as iloIndicator } from "../../sources/Ilostat.ts"
import { bucket } from "../../sources/tests/series.ts"
import { type Offer, Outcome, type Stored, Store } from "../Store.ts"

beforeEach(() => reset())

const flow = IndicatorId.make("OECD.TEST,DSD_PACK@DF_MANY,1.0")

const unit = (at: number) =>
  Schema.decodeSync(Dimensions)({ UNIT: `U${String(at).padStart(3, "0")}` })

const fetched = DateTime.makeUnsafe("2026-11-10T05:00:00Z")

const years = Array.from({ length: 60 }, (_, at) => Year.make(1965 + at))

// One series of the made-up dataflow, valid by default: a value for each
// of 40 countries and 60 years, about 100 KB of JSON, so about ten fill a
// pack. `change` edits its values (undefined drops one).
const series = (
  at: number,
  {
    change = ({ value }: { country: string; year: number; value: number }) => value,
    countries: some = 40,
    version = "2026-11",
    retrievedAt = fetched,
  }: {
    change?: (place: { country: string; year: number; value: number }) => number | undefined
    countries?: number
    version?: string
    retrievedAt?: DateTime.Utc
  } = {},
): Stored => ({
  indicator: { id: flow, name: "Made-up rate", definition: "A rate nobody publishes." },
  dataset: "Made-up statistics",
  dimensions: unit(at),
  version,
  retrievedAt,
  observations: countries.slice(0, some).flatMap(({ code: country }) =>
    years.flatMap((year) => {
      const value = change({ country, year, value: at * 1000 + year + 0.25 })

      return value === undefined ? [] : [{ country, year, value }]
    }),
  ),
})

const many = (count: number, edit: (at: number) => Stored = (at) => series(at)) =>
  Array.from({ length: count }, (_, at) => edit(at))

const write = Effect.fn(function* (candidates: ReadonlyArray<Stored>) {
  const store = yield* Store

  return yield* Stream.runCollect(store.write(flow, Stream.fromIterable(candidates)))
})

const read = Effect.fn(function* (at: number) {
  const store = yield* Store

  return yield* store.read({ indicator: flow, dimensions: unit(at) })
})

const outcomes = (offers: ReadonlyArray<Offer>) =>
  offers.map(({ outcome }) =>
    Outcome.$match(outcome, {
      Stored: () => "Stored",
      Unchanged: () => "Unchanged",
      Held: () => "Held",
    }),
  )

describe("Store", () => {
  it.effect("reads one series from an entry that holds many, through its index", () => {
    const store = bucket()

    return Effect.gen(function* () {
      yield* write(many(40))

      // Forty series of about 100 KB: several packs and their index.
      expect(store.puts()).toBeGreaterThan(3)

      const gets = store.gets()
      const found = yield* read(27)

      expect(store.gets() - gets).toBe(2)
      expect(Option.map(found, ({ dimensions }) => dimensions)).toEqual(
        Option.some({ UNIT: "U027" }),
      )
      expect(
        Option.map(found, ({ observations }) =>
          observations.find(({ country, year }) => country === "AFG" && year === 2000),
        ),
      ).toEqual(Option.some({ country: "AFG", year: 2000, value: 27_000 + 2000 + 0.25 }))
      expect(yield* read(40)).toEqual(Option.none())
    }).pipe(Effect.provide(Store.r2(store.bucket)))
  })

  it.effect("reads an entry whose series fit one pack in one get", () => {
    const store = bucket()

    return Effect.gen(function* () {
      yield* write(many(3, (at) => series(at, { countries: 2 })))

      expect(store.puts()).toBe(1)

      const gets = store.gets()
      const found = yield* read(1)

      expect(store.gets() - gets).toBe(1)
      expect(Option.map(found, ({ observations }) => observations.length)).toEqual(Option.some(120))
      expect(Option.map(found, ({ dataset }) => dataset)).toEqual(Option.some("Made-up statistics"))
    }).pipe(Effect.provide(Store.r2(store.bucket)))
  })

  it.effect("writes nothing when a gather brings the same values", () => {
    const store = bucket()

    return Effect.gen(function* () {
      yield* write(many(40))

      const puts = store.puts()

      const offers = yield* write(
        many(40, (at) =>
          series(at, {
            version: "2026-12",
            retrievedAt: DateTime.makeUnsafe("2026-12-10T05:00:00Z"),
          }),
        ),
      )

      expect(store.puts()).toBe(puts)
      expect(new Set(outcomes(offers))).toEqual(new Set(["Unchanged"]))
      // The stored series still reports when its values were fetched.
      expect(
        Option.map(yield* read(5), ({ retrievedAt }) => DateTime.formatIso(retrievedAt)),
      ).toEqual(Option.some("2026-11-10T05:00:00.000Z"))
    }).pipe(Effect.provide(Store.r2(store.bucket)))
  })

  it.effect("rewrites only the pack of the one series that changed, and its index", () => {
    const store = bucket()

    return Effect.gen(function* () {
      yield* write(many(40))

      const puts = store.puts()

      const offers = yield* write(
        many(40, (at) =>
          at === 23
            ? series(at, { change: ({ year, value }) => (year === 2000 ? 1 : value) })
            : series(at),
        ),
      )

      expect(store.puts() - puts).toBe(2)
      expect(outcomes(offers).filter((outcome) => outcome === "Stored")).toEqual(["Stored"])
      expect(
        Option.map(
          yield* read(23),
          ({ observations }) =>
            observations.find(({ country, year }) => country === "AFG" && year === 2000)?.value,
        ),
      ).toEqual(Option.some(1))
      expect(Option.isSome(yield* read(2))).toBe(true)
    }).pipe(Effect.provide(Store.r2(store.bucket)))
  })

  it.effect("keeps the stored series a write leaves out", () => {
    const store = bucket()

    return Effect.gen(function* () {
      yield* write(many(40))

      const puts = store.puts()

      // A refresh that sends only what changed, as the OECD's updatedAfter answers.
      yield* write([series(31, { change: ({ value }) => value + 1 })])

      expect(store.puts() - puts).toBe(2)
      expect(Option.isSome(yield* read(30))).toBe(true)
      expect(Option.isSome(yield* read(32))).toBe(true)
    }).pipe(Effect.provide(Store.r2(store.bucket)))
  })

  it.effect(
    "holds back a series that would lose values while its neighbours in the pack update",
    () => {
      const store = bucket()

      return Effect.gen(function* () {
        yield* write(many(3, (at) => series(at, { countries: 2 })))

        const before = yield* read(1)

        const offers = yield* write(
          many(3, (at) =>
            series(at, {
              countries: 2,
              version: "2026-12",
              change: ({ year, value }) =>
                at === 1 ? (year === 2024 ? undefined : value) : value * 2,
            }),
          ),
        )

        expect(outcomes(offers)).toEqual(["Stored", "Held", "Stored"])
        expect(offers[1]?.outcome).toMatchObject({
          reason: "Lost",
          lost: [
            { country: "ABW", year: 2024 },
            { country: "AFG", year: 2024 },
          ],
        })
        expect(yield* read(1)).toEqual(before)
        expect(
          Option.map(yield* read(2), ({ version, observations }) => [
            version,
            observations[0]?.value,
          ]),
        ).toEqual(Option.some(["2026-12", (2000 + 1965 + 0.25) * 2]))
      }).pipe(Effect.provide(Store.r2(store.bucket)))
    },
  )

  it.effect("refuses candidates out of order", () => {
    const store = bucket()

    return Effect.gen(function* () {
      const exit = yield* write([series(2), series(1)]).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(store.puts()).toBe(0)
    }).pipe(Effect.provide(Store.r2(store.bucket)))
  })
})

it.effect("keeps missing publisher evidence and replaces a note-only revision", () =>
  Effect.gen(function* () {
    const parsed = yield* record({
      ref_area: "AFG",
      source: "BA:15715",
      indicator: "SDG_B552_NOC_RT",
      time: "2021",
      obs_value: "",
      obs_status: "U",
      note_indicator: "",
      note_source: "R1:3513_S3:8",
    })

    const candidate: Stored = {
      ...parsed,
      indicator: {
        id: iloIndicator,
        name: "Women in senior and middle management",
        definition: "19th ICLS",
      },
      dataset: "ILOSTAT",
      version: "one",
      retrievedAt: fetched,
    }

    const store = yield* Store
    const first = yield* Stream.runCollect(store.write(iloIndicator, Stream.make(candidate)))
    expect(first[0]?.outcome).toEqual(Outcome.Stored())

    const updated = {
      indicator: candidate.indicator,
      dataset: candidate.dataset,
      version: candidate.version,
      retrievedAt: candidate.retrievedAt,
      dimensions: candidate.dimensions,
      observations: candidate.observations,
      qualifications: parsed.qualifications.map((item) =>
        Object.assign({}, item, { notes: item.notes.filter((note) => note.code !== "R1:3513") }),
      ),
    }

    const second = yield* Stream.runCollect(store.write(iloIndicator, Stream.make(updated)))
    expect(second[0]?.outcome).toEqual(Outcome.Stored())
    const found = yield* store.read({ indicator: iloIndicator, dimensions: candidate.dimensions })
    expect(Option.isSome(found)).toBe(true)

    if (Option.isSome(found)) {
      expect(found.value.observations).toEqual([])
      expect(found.value.qualifications).toEqual(updated.qualifications)
    }
  }).pipe(Effect.provide(Store.r2(bucket().bucket))),
)
