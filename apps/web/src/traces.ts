import { Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { OtlpExporter, OtlpSerialization, OtlpTracer } from "effect/observability"

import { requestLocale } from "./locale.tsx"

// The browser's spans: each question from the moment it is asked to its last
// step, each API request, which the server's spans continue, and each error
// the page did not catch. They go to this origin, whose Worker passes them on
// to the stage's destination (packages/server/src/platform/Traces.ts), as JSON, which
// the browser's network panel can show.

// Sends with keepalive, so a batch sent as the page goes away still arrives.
const keepalive = Layer.effect(
  HttpClient.HttpClient,
  Effect.map(HttpClient.HttpClient, (client) =>
    client.pipe(
      HttpClient.transformResponse(
        Effect.provideService(FetchHttpClient.RequestInit, { keepalive: true }),
      ),
      HttpClient.mapRequest((outgoing) =>
        HttpClientRequest.setHeader(outgoing, "X-User-Locale", requestLocale()),
      ),
    ),
  ),
).pipe(Layer.provide(FetchHttpClient.layer))

const exporter = OtlpTracer.layer({
  url: "/api/otlp/v1/traces",
  resource: { serviceName: "openfacts-web" },
}).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(keepalive))

// An error the page did not catch, as a failed span of its own.
const uncaught = (error: Error) =>
  Effect.die(error).pipe(
    Effect.withSpan("page.error", { attributes: { "url.path": window.location.pathname } }),
    Effect.exit,
  )

// Exports what is buffered once the page is hidden or left, since a page
// that closes loses the rest, and records the errors nothing caught.
const watched = Layer.effectDiscard(
  Effect.gen(function* () {
    const flusher = yield* OtlpExporter.Flusher
    const run = Effect.runForkWith(yield* Effect.context())

    const flush = () => run(flusher.flush)

    const hidden = () => {
      if (document.visibilityState === "hidden") flush()
    }

    const failed = (event: ErrorEvent) =>
      run(uncaught(event.error instanceof Error ? event.error : new Error(event.message)))

    const rejected = (event: PromiseRejectionEvent) =>
      run(
        uncaught(
          event.reason instanceof Error
            ? event.reason
            : new Error("A promise was rejected with something other than an Error"),
        ),
      )

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        document.addEventListener("visibilitychange", hidden)
        window.addEventListener("pagehide", flush)
        window.addEventListener("error", failed)
        window.addEventListener("unhandledrejection", rejected)
      }),
      () =>
        Effect.sync(() => {
          document.removeEventListener("visibilitychange", hidden)
          window.removeEventListener("pagehide", flush)
          window.removeEventListener("error", failed)
          window.removeEventListener("unhandledrejection", rejected)
        }),
    )
  }),
)

let runtime: ManagedRuntime.ManagedRuntime<OtlpExporter.Flusher, never> | undefined

// The page's runtime, built on first use. Only the browser uses it: the
// server renders no work and sends no request through the page's origin.
export const traced = () => (runtime ??= ManagedRuntime.make(Layer.provideMerge(watched, exporter)))
