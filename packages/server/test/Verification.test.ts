import {
  Api,
  IndicatorId,
  Trend,
  Year,
  verificationAction,
  verificationHeader,
} from "@openfacts/domain"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Redacted } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

import { Agent } from "../src/Agent.ts"
import { AskLimit } from "../src/AskLimit.ts"
import { Catalog } from "../src/Catalog.ts"
import { Conversations } from "../src/Conversations.ts"
import { Directions } from "../src/Directions.ts"
import { Handlers } from "../src/Handlers.ts"
import { Notes } from "../src/Notes.ts"
import { Politics } from "../src/Politics.ts"
import { Sources } from "../src/Sources.ts"
import { Verification } from "../src/Verification.ts"
import { http } from "./fakes.ts"

const question = "/api/conversations/123e4567-e89b-42d3-a456-426614174000/questions"
const explanation = "/api/views/explain"

interface RequestOptions {
  token?: string
  reply?: () => Response
}

const accepted = () =>
  Response.json({ success: true, hostname: "openfacts.app", action: verificationAction })

// Real HTTP handlers and validation; only Cloudflare's Siteverify wire is fake.
const send = (path: string, { token = "browser-proof", reply = accepted }: RequestOptions = {}) => {
  const layer = HttpApiBuilder.layer(Api).pipe(
    Layer.provide(Handlers),
    Layer.provide(
      Verification.layer(Redacted.make("test-secret")).pipe(Layer.provide(http(reply))),
    ),
    Layer.provide(Conversations.unavailable),
    Layer.provide(Agent.unavailable),
    Layer.provide(AskLimit.none),
    Layer.provide(Catalog.unavailable),
    Layer.provide(Politics.unavailable),
    Layer.provide(Notes.live),
    Layer.provide(Sources.live),
    Layer.provide(Directions.listed),
    Layer.provide(HttpServer.layerServices),
  )

  return Effect.acquireUseRelease(
    Effect.sync(() => HttpRouter.toWebHandler(layer)),
    (server) =>
      Effect.promise(async () => {
        const response = await server.handler(
          new Request(`https://openfacts.app${path}`, {
            method: "POST",
            headers: { "content-type": "application/json", [verificationHeader]: token },
            body: JSON.stringify(
              path === question
                ? { question: "How is France doing?" }
                : Trend.make({
                    indicator: IndicatorId.make("SP.POP.TOTL"),
                    countries: ["FRA"],
                    from: Year.make(2000),
                    to: Year.make(2020),
                  }),
            ),
          }),
        )

        return { status: response.status, body: await response.json() }
      }),
    (server) => Effect.promise(() => server.dispose()),
  )
}

describe("Turnstile at the paid request boundary", () => {
  for (const path of [question, explanation]) {
    it.effect(`rejects a missing proof at ${path}`, () =>
      Effect.gen(function* () {
        const response = yield* send(path, { token: "" })
        expect(response.status).toBe(403)
        expect(response.body).toHaveProperty("_tag", "VerificationRequired")
      }),
    )

    it.effect(`allows a valid proof through to the agent at ${path}`, () =>
      Effect.gen(function* () {
        const response = yield* send(path)
        expect(response.status).toBe(503)
        expect(response.body).toHaveProperty("_tag", "AgentUnavailable")
      }),
    )
  }

  for (const reply of [
    { success: false },
    { success: true, hostname: "another.example", action: verificationAction },
    { success: true, hostname: "openfacts.app", action: "another-action" },
  ]) {
    it.effect(`rejects a proof with ${JSON.stringify(reply)}`, () =>
      Effect.gen(function* () {
        const response = yield* send(question, { reply: () => Response.json(reply) })
        expect(response.status).toBe(403)
        expect(response.body).toHaveProperty("_tag", "VerificationRequired")
      }),
    )
  }

  it.effect("fails closed when Cloudflare is unavailable", () =>
    Effect.gen(function* () {
      const response = yield* send(question, { reply: () => new Response(null, { status: 503 }) })
      expect(response.status).toBe(503)
      expect(response.body).toHaveProperty("_tag", "VerificationUnavailable")
    }),
  )

  it.effect("fails closed when Cloudflare returns an invalid response", () =>
    Effect.gen(function* () {
      const response = yield* send(question, { reply: () => Response.json({ success: "yes" }) })
      expect(response.status).toBe(503)
      expect(response.body).toHaveProperty("_tag", "VerificationUnavailable")
    }),
  )
})
