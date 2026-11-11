import { expect, it } from "@effect/vitest"
import { Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"

import { d1 } from "../scripts/d1.ts"
import { http } from "./fakes.ts"

const target = {
  account: "account",
  database: "preview",
  token: Redacted.make("private-test-token"),
}

it.effect("reads D1 rows and counts the API's usage", () => {
  const { layer, usage } = d1(target)

  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    expect(yield* sql`SELECT 7 AS value`).toEqual([{ value: 7 }])
    expect(usage).toEqual({ read: 1, written: 0 })
  }).pipe(
    Effect.provide(
      layer.pipe(
        Layer.provide(
          http(() =>
            Response.json({
              result: [{ results: [{ value: 7 }], meta: { rows_read: 1, rows_written: 0 } }],
            }),
          ),
        ),
      ),
    ),
  )
})

it.effect("reports a D1 rejection without retaining the authenticated request", () => {
  const { layer } = d1(target)

  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const error = yield* sql`SELECT 7`.pipe(Effect.flip)
    const text = JSON.stringify(error)

    expect(text).toContain("D1 answered 500")
    expect(text).toContain("temporary failure")
    expect(text).not.toContain("private-test-token")
    expect(text).not.toContain("authorization")
  }).pipe(
    Effect.provide(
      layer.pipe(Layer.provide(http(() => new Response("temporary failure", { status: 500 })))),
    ),
  )
})
