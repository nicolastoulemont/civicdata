import { Api, verificationHeader } from "@openfacts/domain"
import { Effect, Layer, Option, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from "effect/http"
import { HttpApiClient } from "effect/http-api"

import { requestLocale } from "@/locale"
import { traced } from "@/traces"

// Where API requests go. A relative base URL resolves against the page.
export interface Transport {
  readonly baseUrl: string | undefined
  readonly layer: Layer.Layer<HttpClient.HttpClient>
}

// The page's own origin, with the page's tracer: each request's span goes to
// the trace of what asked for it, and the server's spans continue it.
export const page: Transport = {
  baseUrl: undefined,
  layer: Layer.merge(
    FetchHttpClient.layer,
    Layer.unwrap(Effect.sync(() => Layer.effectContext(traced().contextEffect))),
  ),
}

const authorize = (outgoing: HttpClientRequest.HttpClientRequest) => {
  const request = HttpClientRequest.setHeader(outgoing, "X-User-Locale", requestLocale())

  const sitekey = Schema.decodeUnknownOption(Schema.NonEmptyString)(
    import.meta.env["VITE_TURNSTILE_SITE_KEY"],
  )

  const path = new URL(outgoing.url, "https://localhost").pathname

  const paid =
    outgoing.method === "POST" &&
    (path === "/api/views/explain" || /^\/api\/conversations\/[^/]+\/questions$/.test(path))

  if (!paid || Option.isNone(sitekey)) return Effect.succeed(request)

  return Effect.tryPromise(() => import("./verification.tsx")).pipe(
    Effect.flatMap(({ challenge }) => challenge(sitekey.value)),
    Effect.map((token) => HttpClientRequest.setHeader(request, verificationHeader, token)),
    Effect.mapError(
      () =>
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({
            request,
          }),
        }),
    ),
  )
}

// One request, failing with the API's typed error or a transport error.
// Interrupting it aborts the request.
export const request = <A, E>(
  transport: Transport,
  use: (api: HttpApiClient.ForApi<typeof Api>) => Effect.Effect<A, E>,
) =>
  HttpApiClient.make(Api, {
    baseUrl: transport.baseUrl,
    transformClient: HttpClient.mapRequestEffect(authorize),
  }).pipe(Effect.flatMap(use), Effect.provide(transport.layer))

// Runs one request, rejecting with the API's typed error or a transport error.
export const call = <A, E>(
  transport: Transport,
  use: (api: HttpApiClient.ForApi<typeof Api>) => Effect.Effect<A, E>,
) => Effect.runPromise(request(transport, use))
