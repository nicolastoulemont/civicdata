import {
  verificationAction,
  verificationHeader,
  VerificationRequired,
  VerificationToken,
  VerificationUnavailable,
} from "@openfacts/domain"
import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import type { HttpServerRequest } from "effect/http"

interface Interface {
  readonly check: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<void, VerificationRequired | VerificationUnavailable>
}

const Verified = Schema.Struct({
  success: Schema.Boolean,
  hostname: Schema.optionalKey(Schema.String),
  action: Schema.optionalKey(Schema.String),
})

// A browser proof is redeemed once, before a request can spend model credits.
export class Verification extends Context.Service<Verification, Interface>()(
  "@openfacts/server/Verification",
) {
  static readonly none = Layer.succeed(Verification, Verification.of({ check: () => Effect.void }))

  static readonly unavailable = Layer.succeed(
    Verification,
    Verification.of({ check: () => Effect.fail(new VerificationUnavailable()) }),
  )

  static readonly layer = (secret: Redacted.Redacted) =>
    Layer.effect(
      Verification,
      Effect.gen(function* () {
        const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)

        return Verification.of({
          check: Effect.fn("Verification.check")(function* (request) {
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

            return yield* Effect.void
          }),
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
