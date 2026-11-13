import { describe, expect, it } from "@effect/vitest"
import { verificationAction, verificationHeader } from "@repo/domain"
import { Effect, Layer, Redacted } from "effect"
import { HttpEffect, type HttpServerRequest, HttpServerResponse } from "effect/http"
import { TestClock } from "effect/testing"

import { Verification } from "../Verification.ts"
import { http } from "./fakes.ts"

const accepted = () =>
  Response.json({ success: true, hostname: "openfacts.app", action: verificationAction })

// A paid route behind the real check, with only Cloudflare's Siteverify
// response faked. Each request answers 204 when it passes, and the status of
// the error it fails with otherwise. `proofs` counts the proofs redeemed.
const serve = (reply: () => Response = accepted) =>
  Effect.gen(function* () {
    let proofs = 0

    const { check } = yield* Verification.pipe(
      Effect.provide(
        Verification.layer(Redacted.make("test-secret")).pipe(
          Layer.provide(
            http(() => {
              proofs += 1

              return reply()
            }),
          ),
        ),
      ),
    )

    const route = check.pipe(
      Effect.as(HttpServerResponse.empty({ status: 204 })),
      Effect.catchTags({
        VerificationRequired: () => Effect.succeed(HttpServerResponse.empty({ status: 403 })),
        VerificationUnavailable: () => Effect.succeed(HttpServerResponse.empty({ status: 503 })),
      }),
    )

    // The test's context carries its clock into each request.
    const handler = HttpEffect.toWebHandlerWith<never, HttpServerRequest.HttpServerRequest>(
      yield* Effect.context(),
    )(route)

    const send = (headers: Record<string, string> = {}) =>
      Effect.promise(() =>
        handler(
          new Request("https://openfacts.app/api/views/explain", { method: "POST", headers }),
        ),
      )

    return { send, proofs: () => proofs }
  })

const proof = { [verificationHeader]: "browser-proof" }

// The cookie a response sets, as the browser sends it back.
const pass = (response: Response) => response.headers.get("set-cookie")?.split(";")[0] ?? ""

describe("Turnstile verification", () => {
  it.effect("gives a browser that passes a proof a pass for its session", () =>
    Effect.gen(function* () {
      const { send } = yield* serve()

      const response = yield* send(proof)

      expect(response.status).toBe(204)
      expect(response.headers.get("set-cookie")).toMatch(
        /^__Host-verified=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Strict$/,
      )
    }),
  )

  it.effect("lets a browser with a pass ask again without a proof", () =>
    Effect.gen(function* () {
      const { send, proofs } = yield* serve()
      const cookie = pass(yield* send(proof))

      expect((yield* send({ cookie })).status).toBe(204)
      expect(proofs()).toBe(1)
    }),
  )

  it.effect("asks for a proof again once a pass is a day old", () =>
    Effect.gen(function* () {
      const { send } = yield* serve()
      const cookie = pass(yield* send(proof))

      yield* TestClock.adjust("24 hours")

      expect((yield* send({ cookie })).status).toBe(403)
    }),
  )

  it.effect("rejects a pass whose expiry was changed", () =>
    Effect.gen(function* () {
      const { send } = yield* serve()

      const cookie = pass(yield* send(proof)).replace(
        /=(\d+)\./,
        (_, expiry: string) => `=${Number(expiry) + 1}.`,
      )

      expect((yield* send({ cookie })).status).toBe(403)
    }),
  )

  it.effect("rejects a missing proof", () =>
    Effect.gen(function* () {
      const { send } = yield* serve()

      expect((yield* send()).status).toBe(403)
    }),
  )

  for (const reply of [
    { success: false },
    { success: true, hostname: "another.example", action: verificationAction },
    { success: true, hostname: "openfacts.app", action: "another-action" },
  ]) {
    it.effect(`rejects a proof with ${JSON.stringify(reply)} and gives no pass`, () =>
      Effect.gen(function* () {
        const { send } = yield* serve(() => Response.json(reply))
        const response = yield* send(proof)

        expect(response.status).toBe(403)
        expect(response.headers.get("set-cookie")).toBeNull()
      }),
    )
  }

  it.effect("fails closed when Cloudflare is unavailable", () =>
    Effect.gen(function* () {
      const { send } = yield* serve(() => new Response(null, { status: 503 }))

      expect((yield* send(proof)).status).toBe(503)
    }),
  )

  it.effect("fails closed when Cloudflare returns an invalid response", () =>
    Effect.gen(function* () {
      const { send } = yield* serve(() => Response.json({ success: "yes" }))

      expect((yield* send(proof)).status).toBe(503)
    }),
  )
})
