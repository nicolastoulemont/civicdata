import { Api, verificationHeader, VerificationRequired } from "@repo/domain"
import { Effect, Layer, Option, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
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

// How a request the server refuses without a pass gets a Turnstile proof:
// by asking the person in a dialog, or in the background, giving up when
// Cloudflare wants the person to interact.
type Challenge = "dialog" | "background"

export interface RequestOptions {
  readonly challenge?: Challenge
}

// A proof earns the browser a pass for the rest of its session, which the app
// asks for once it loads (`verify`). A request the server still refuses with
// VerificationRequired gets a proof and goes once more, carrying it. A proof
// that fails or is dismissed keeps the server's VerificationRequired.
const verified = (client: HttpClient.HttpClient, challenge: Challenge) =>
  HttpClient.transform(client, (effect, outgoing) =>
    Effect.flatMap(effect, (response) => {
      const sitekey = Schema.decodeUnknownOption(Schema.NonEmptyString)(
        import.meta.env["VITE_TURNSTILE_SITE_KEY"],
      )

      if (response.status !== 403 || Option.isNone(sitekey)) return Effect.succeed(response)

      return HttpClientResponse.schemaBodyJson(VerificationRequired)(response).pipe(
        Effect.andThen(Effect.tryPromise(() => import("./verification.tsx"))),
        Effect.flatMap((proofs) => proofs[challenge](sitekey.value)),
        Effect.matchEffect({
          onFailure: () => Effect.succeed(response),
          onSuccess: (token) =>
            client.execute(HttpClientRequest.setHeader(outgoing, verificationHeader, token)),
        }),
      )
    }),
  )

// One request, failing with the API's typed error or a transport error.
// Interrupting it aborts the request.
export const request = <A, E>(
  transport: Transport,
  use: (api: HttpApiClient.ForApi<typeof Api>) => Effect.Effect<A, E>,
  { challenge = "dialog" }: RequestOptions = {},
) =>
  HttpApiClient.make(Api, {
    baseUrl: transport.baseUrl,
    transformClient: (client) =>
      verified(
        HttpClient.mapRequest(client, (outgoing) =>
          HttpClientRequest.setHeader(outgoing, "X-User-Locale", requestLocale()),
        ),
        challenge,
      ),
  }).pipe(Effect.flatMap(use), Effect.provide(transport.layer))

// Gets the browser its pass in the background once the app loads, so its
// first question or chart explanation goes without a challenge. A browser
// that holds a pass already costs one request. One that Cloudflare wants to
// see interact gets no pass here, and is asked when it first needs one.
export const verify = request(page, (api) => api.verify(), { challenge: "background" }).pipe(
  Effect.ignore,
)

// Runs one request, rejecting with the API's typed error or a transport error.
export const call = <A, E>(
  transport: Transport,
  use: (api: HttpApiClient.ForApi<typeof Api>) => Effect.Effect<A, E>,
) => Effect.runPromise(request(transport, use))
