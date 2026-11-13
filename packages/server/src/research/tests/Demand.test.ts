import { D1Client } from "@effect/sql-d1"
import { beforeEach, describe, expect, it } from "@effect/vitest"
import { reset } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { DateTime, Duration, Effect, Layer } from "effect"
import { TestClock } from "effect/testing"

import { Demand, DemandUnavailable } from "../Demand.ts"
import { Version } from "../store.ts"

const db = env.DB

if (db === undefined) throw new Error("vitest.config.ts must bind DB")

type Database = typeof db

const version = (digit: string) => Version.fields.id.make(digit.repeat(64))

const a = version("a")
const b = version("b")
const c = version("c")

beforeEach(() => reset())

// Every row of the demand table, in version order.
const rows = Effect.promise(() =>
  db.prepare("SELECT version, count, last FROM demand ORDER BY version").all(),
).pipe(Effect.map(({ results }) => results))

const at = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis))

type Statement = ReturnType<Database["prepare"]>

// The test Worker's DB, with `change` applied to each statement it prepares.
const through = (change: (query: string, statement: Statement) => void): Database => ({
  prepare: (query) => {
    const statement = db.prepare(query)

    change(query, statement)

    return statement
  },
  batch: (statements) => db.batch(statements),
  exec: (query) => db.exec(query),
  withSession: (constraint) => db.withSession(constraint),
  dump: () => db.dump(),
})

// The test Worker's DB, telling `ran` the SQL of each statement it binds to
// run. The client caches prepared statements, so it watches binds.
const watched = (ran: (query: string) => void) =>
  through((query, statement) => {
    const bind = statement.bind.bind(statement)

    statement.bind = (...values) => {
      ran(query)

      return bind(...values)
    }
  })

const refuse = () => Promise.reject(new Error("D1_ERROR: D1 DB is overloaded."))

// The test Worker's DB, refusing every statement as production's D1 does
// when overloaded.
const refusing = through((_, statement) => {
  statement.bind = () => statement
  statement.all = refuse
  statement.raw = refuse
  statement.run = refuse
})

const over = (database: Database) =>
  Demand.make.pipe(Layer.provide(D1Client.layer({ db: database }).pipe(Layer.orDie)))

describe("demand", () => {
  it.effect("adds up concurrent calls for the same version", () =>
    Effect.gen(function* () {
      const demand = yield* Demand

      yield* Effect.all(
        Array.from({ length: 8 }, () => demand.record([a])),
        { concurrency: "unbounded", discard: true },
      )

      expect(yield* rows).toEqual([{ version: a, count: 8, last: at(0) }])
    }).pipe(Effect.provide(Demand.layer)),
  )

  it.effect("counts a version once per call, however often the call names it", () =>
    Effect.gen(function* () {
      const demand = yield* Demand

      yield* demand.record([a, b])
      yield* TestClock.adjust(Duration.minutes(1))
      yield* demand.record([b, c, c])

      expect(yield* rows).toEqual([
        { version: a, count: 1, last: at(0) },
        { version: b, count: 2, last: at(60_000) },
        { version: c, count: 1, last: at(60_000) },
      ])
    }).pipe(Effect.provide(Demand.layer)),
  )

  it.effect("records with one upsert and reads nothing", () => {
    const queries: Array<string> = []

    return Effect.gen(function* () {
      const demand = yield* Demand

      yield* demand.record([a])
      queries.length = 0
      yield* demand.record([a, b])

      expect(queries).toHaveLength(1)
      expect(queries[0]).toMatch(/^\s*INSERT INTO demand .* ON CONFLICT/s)
    }).pipe(Effect.provide(over(watched((query) => queries.push(query)))))
  })

  it.effect("records nothing for no versions", () => {
    const queries: Array<string> = []

    return Effect.gen(function* () {
      yield* (yield* Demand).record([])

      expect(queries).toEqual([])
    }).pipe(Effect.provide(over(watched((query) => queries.push(query)))))
  })

  it.effect("reads the versions asked for since a time, most asked first", () =>
    Effect.gen(function* () {
      const demand = yield* Demand

      yield* demand.record([a, b])
      yield* demand.record([a])
      yield* TestClock.adjust(Duration.days(1))
      const day = yield* DateTime.now
      yield* demand.record([b])
      yield* demand.record([b, c])

      expect(yield* demand.since(day)).toEqual([
        { version: b, count: 3, last: day },
        { version: c, count: 1, last: day },
      ])
      expect(yield* demand.since(DateTime.add(day, { seconds: 1 }))).toEqual([])
    }).pipe(Effect.provide(Demand.layer)),
  )

  it.effect("fails with a typed error when the database fails", () =>
    Effect.gen(function* () {
      const demand = yield* Demand

      expect(yield* demand.record([a]).pipe(Effect.flip)).toBeInstanceOf(DemandUnavailable)
      expect(yield* demand.since(DateTime.makeUnsafe(0)).pipe(Effect.flip)).toBeInstanceOf(
        DemandUnavailable,
      )
    }).pipe(Effect.provide(over(refusing))),
  )
})
