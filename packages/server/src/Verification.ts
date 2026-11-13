import {
  verificationAction,
  verificationHeader,
  VerificationRequired,
  VerificationToken,
  VerificationUnavailable,
} from "@repo/domain"
import { Clock, Context, Duration, Effect, Layer, Option, Redacted, Result, Schema } from "effect"
import * as Base64Url from "effect/encoding/Base64Url"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpEffect,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http"

interface Interface {
  // Passes the current request when its browser holds a pass, or redeems the
  // proof it carries and gives the browser a pass.
  readonly check: Effect.Effect<
    void,
    VerificationRequired | VerificationUnavailable,
    HttpServerRequest.HttpServerRequest
  >
}

const Verified = Schema.Struct({
  success: Schema.Boolean,
  hostname: Schema.optionalKey(Schema.String),
  action: Schema.optionalKey(Schema.String),
})

// A pass lets one browser session ask without another challenge. The cookie
// ends with the session, and its signed expiry caps a session the browser
// restores.
const cookie = "__Host-verified"
const lifetime = Duration.hours(24)

// A pass is `<expiry in epoch ms>.<signature>`.
const pass = /^(\d+)\.([\w-]+)$/

const encoder = new TextEncoder()
const signed = (expiry: number) => encoder.encode(`${verificationAction}:${expiry}`)

// A browser proof is redeemed once, before a request can spend model credits.
// It earns the browser a pass for the rest of its session.
export class Verification extends Context.Service<Verification, Interface>()(
  "@repo/server/Verification",
) {
  static readonly none = Layer.succeed(Verification, Verification.of({ check: Effect.void }))

  static readonly unavailable = Layer.succeed(
    Verification,
    Verification.of({ check: Effect.fail(new VerificationUnavailable()) }),
  )

  static readonly layer = (secret: Redacted.Redacted) =>
    Layer.effect(
      Verification,
      Effect.gen(function* () {
        const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)

        const key = yield* Effect.promise(() =>
          crypto.subtle.importKey(
            "raw",
            encoder.encode(Redacted.value(secret)),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign", "verify"],
          ),
        )

        const holds = Effect.fnUntraced(function* (request: HttpServerRequest.HttpServerRequest) {
          const match = pass.exec(request.cookies[cookie] ?? "")

          const signature = Option.fromNullishOr(match?.[2]).pipe(
            Option.flatMap((text) => Result.getSuccess(Base64Url.decode(text))),
          )

          if (match === null || Option.isNone(signature)) return false

          const expiry = Number(match[1])

          if (expiry <= (yield* Clock.currentTimeMillis)) return false

          return yield* Effect.promise(() =>
            crypto.subtle.verify("HMAC", key, new Uint8Array(signature.value), signed(expiry)),
          )
        })

        const grant = Effect.gen(function* () {
          const expiry = (yield* Clock.currentTimeMillis) + Duration.toMillis(lifetime)

          const signature = yield* Effect.promise(() =>
            crypto.subtle.sign("HMAC", key, signed(expiry)),
          )

          yield* HttpEffect.appendPreResponseHandler((_, response) =>
            HttpServerResponse.setCookie(
              response,
              cookie,
              `${expiry}.${Base64Url.encode(new Uint8Array(signature))}`,
              { httpOnly: true, secure: true, sameSite: "strict", path: "/" },
            ).pipe(Effect.orDie),
          )
        })

        const redeem = Effect.fnUntraced(function* (request: HttpServerRequest.HttpServerRequest) {
          const token = yield* Schema.decodeUnknownEffect(VerificationToken)(
            request.headers[verificationHeader],
          ).pipe(Effect.mapError(() => new VerificationRequired()))

          const hostname = yield* Effect.try(() => new URL(request.originalUrl).hostname).pipe(
            Effect.mapError(() => new VerificationRequired()),
          )

          const verified = yield* HttpClientRequest.post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
          ).pipe(
            HttpClientRequest.bodyJson({ secret: Redacted.value(secret), response: token }),
            Effect.flatMap(client.execute),
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Verified)),
            Effect.timeout("10 seconds"),
            Effect.mapError(() => new VerificationUnavailable()),
          )

          if (
            !verified.success ||
            verified.action !== verificationAction ||
            verified.hostname !== hostname
          ) {
            return yield* new VerificationRequired()
          }

          return yield* grant
        })

        return Verification.of({
          check: Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest

            const held = yield* holds(request)

            yield* Effect.annotateCurrentSpan("openfacts.verification", held ? "pass" : "proof")

            if (!held) yield* redeem(request)
          }).pipe(Effect.withSpan("Verification.check")),
        })
      }),
    )

  static readonly live = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.match({
        onFailure: () => Verification.none,
        onSuccess: ({ env }) => {
          const secret = env.TURNSTILE_SECRET_KEY

          if (secret !== undefined && secret !== "") {
            return Verification.layer(Redacted.make(secret)).pipe(
              Layer.provide(FetchHttpClient.layer),
            )
          }

          return env.STAGE === "prod" || /^pr-[1-9]\d*$/.test(env.STAGE ?? "")
            ? Verification.unavailable
            : Verification.none
        },
      }),
    ),
  )
}
