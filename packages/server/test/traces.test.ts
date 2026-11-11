import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpBody, HttpClient, HttpClientResponse, HttpRouter } from "effect/http"

import * as Traces from "../src/Traces.ts"

// A batch of spans as the browser's exporter sends it: OTLP protobuf bytes.
const batch = new Uint8Array([10, 3, 18, 1, 0])

// A made-up key. Built here rather than written out, so secret scanners do
// not take it for a real one.
const key = btoa("instance:token")

// The stage's destination, as Grafana Cloud's OTLP page prints it.
const grafana = {
  OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp-gateway.example.grafana.net/otlp",
  OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Basic%20${key}`,
}

interface Received {
  readonly url: string
  readonly authorization: string | undefined
  readonly body: ReadonlyArray<number> | undefined
}

// The destination's side of the wire: each request it received, answered 200.
const destination = () => {
  const received: Array<Received> = []

  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        received.push({
          url: request.url,
          authorization: request.headers["authorization"],
          body: request.body instanceof HttpBody.Uint8Array ? [...request.body.body] : undefined,
        })

        return HttpClientResponse.fromWeb(request, new Response(null, { status: 200 }))
      }),
    ),
  )

  return { received, layer }
}

interface SendOptions {
  readonly settings?: Record<string, string>
  readonly limit?: Layer.Layer<Traces.TraceLimit>
}

// Sends the batch from a visitor's browser to the Worker's proxy route.
const send = (
  upstream: Layer.Layer<HttpClient.HttpClient>,
  { settings = grafana, limit = Traces.TraceLimit.none }: SendOptions = {},
) =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        Traces.proxy.pipe(
          Layer.provide(limit),
          Layer.provide(upstream),
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(settings))),
        ),
        { disableLogger: true },
      ),
    ),
    ({ handler }) =>
      Effect.promise(() =>
        handler(
          new Request(`http://localhost${Traces.path}`, {
            method: "POST",
            headers: {
              "content-type": "application/x-protobuf",
              "cf-connecting-ip": "203.0.113.7",
            },
            body: batch,
          }),
        ),
      ),
    ({ dispose }) => Effect.promise(dispose),
  )

describe("the browser's spans", () => {
  it.effect("go on to the stage's destination with its key, which the browser never sees", () => {
    const upstream = destination()

    return Effect.gen(function* () {
      const response = yield* send(upstream.layer)

      expect(response.status).toBe(200)
      expect(upstream.received).toEqual([
        {
          url: "https://otlp-gateway.example.grafana.net/otlp/v1/traces",
          authorization: `Basic ${key}`,
          body: [...batch],
        },
      ])
    })
  })

  it.effect("are dropped on a stage with no destination", () => {
    const upstream = destination()

    return Effect.gen(function* () {
      const response = yield* send(upstream.layer, { settings: {} })

      expect(response.status).toBe(204)
      expect(upstream.received).toEqual([])
    })
  })

  it.effect("are refused from a visitor over the limit", () => {
    const upstream = destination()

    const full = Layer.succeed(
      Traces.TraceLimit,
      Traces.TraceLimit.of({ allows: () => Effect.succeed(false) }),
    )

    return Effect.gen(function* () {
      const response = yield* send(upstream.layer, { limit: full })

      expect(response.status).toBe(429)
      expect(upstream.received).toEqual([])
    })
  })
})
