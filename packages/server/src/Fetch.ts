import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"

// How the app names itself to the publishers it asks. Workers' fetch sends no
// User-Agent, and some hosts refuse a request without one: FAOSTAT's bulk host
// answers 403.
const userAgent = "openfacts (+https://openfacts.app)"

// The platform's fetch, naming the app on every request.
export const layer = Layer.effect(
  HttpClient.HttpClient,
  Effect.map(
    HttpClient.HttpClient,
    HttpClient.mapRequest(HttpClientRequest.setHeader("user-agent", userAgent)),
  ),
).pipe(Layer.provide(FetchHttpClient.layer))
