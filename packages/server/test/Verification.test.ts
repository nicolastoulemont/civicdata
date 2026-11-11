import { describe, expect, it } from "@effect/vitest"
import {
  verificationAction,
  verificationHeader,
  VerificationRequired,
  VerificationUnavailable,
} from "@openfacts/domain"
import { Effect, Layer, Redacted } from "effect"
import { HttpServerRequest } from "effect/http"

import { Verification } from "../src/Verification.ts"
import { http } from "./fakes.ts"

interface CheckOptions {
  token?: string
  reply?: () => Response
}

const accepted = () =>
  Response.json({ success: true, hostname: "openfacts.app", action: verificationAction })

// The real Siteverify adapter, with only Cloudflare's HTTP response faked.
const check = ({ token = "browser-proof", reply = accepted }: CheckOptions = {}) =>
  Verification.use((verification) =>
    verification.check(
      HttpServerRequest.fromWeb(
        new Request("https://openfacts.app/api/views/explain", {
          method: "POST",
          headers: { [verificationHeader]: token },
        }),
      ),
    ),
  ).pipe(
    Effect.provide(
      Verification.layer(Redacted.make("test-secret")).pipe(Layer.provide(http(reply))),
    ),
  )

describe("Turnstile verification", () => {
  it.effect("accepts a proof for this hostname and action", () =>
    Effect.gen(function* () {
      expect(yield* check()).toBeUndefined()
    }),
  )

  it.effect("rejects a missing proof", () =>
    Effect.gen(function* () {
      expect(yield* check({ token: "" }).pipe(Effect.flip)).toBeInstanceOf(VerificationRequired)
    }),
  )

  for (const reply of [
    { success: false },
    { success: true, hostname: "another.example", action: verificationAction },
    { success: true, hostname: "openfacts.app", action: "another-action" },
  ]) {
    it.effect(`rejects a proof with ${JSON.stringify(reply)}`, () =>
      Effect.gen(function* () {
        expect(
          yield* check({ reply: () => Response.json(reply) }).pipe(Effect.flip),
        ).toBeInstanceOf(VerificationRequired)
      }),
    )
  }

  it.effect("fails closed when Cloudflare is unavailable", () =>
    Effect.gen(function* () {
      expect(
        yield* check({ reply: () => new Response(null, { status: 503 }) }).pipe(Effect.flip),
      ).toBeInstanceOf(VerificationUnavailable)
    }),
  )

  it.effect("fails closed when Cloudflare returns an invalid response", () =>
    Effect.gen(function* () {
      expect(
        yield* check({ reply: () => Response.json({ success: "yes" }) }).pipe(Effect.flip),
      ).toBeInstanceOf(VerificationUnavailable)
    }),
  )
})
