import { TooManyQuestions } from "@repo/domain"
import { Context, Effect, Layer } from "effect"

interface Interface {
  // Counts one question from a visitor, failing when they are over the limit.
  readonly count: (visitor: string) => Effect.Effect<void, TooManyQuestions>
}

// Each question costs model calls, so a deployment caps how often one visitor
// can ask. The cap itself lives in the ASK_LIMIT binding's configuration.
export class AskLimit extends Context.Service<AskLimit, Interface>()("@repo/server/AskLimit") {
  static readonly none = Layer.succeed(AskLimit, AskLimit.of({ count: () => Effect.void }))

  // The Workers rate limit binding, when the deployment has one. A failing
  // limiter lets the question through: a broken counter should not take the
  // agent down with it.
  static readonly live = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) => {
        const limiter = env.ASK_LIMIT

        return limiter === undefined
          ? AskLimit.none
          : Layer.succeed(
              AskLimit,
              AskLimit.of({
                count: (visitor) =>
                  Effect.tryPromise(() => limiter.limit({ key: visitor })).pipe(
                    Effect.tapError((error) => Effect.logWarning("Ask limit failed", error)),
                    Effect.orElseSucceed(() => ({ success: true })),
                    Effect.flatMap(({ success }) =>
                      success ? Effect.void : Effect.fail(new TooManyQuestions()),
                    ),
                  ),
              }),
            )
      }),
      Effect.orElseSucceed(() => AskLimit.none),
    ),
  )
}
