import { AgentUnavailable, type ConversationId } from "@civicdata/domain"
import { Context, Effect, Layer } from "effect"
import { HttpTraceContext } from "effect/http"

// The request as this Worker's span sends it on: the conversation's spans sit
// inside the Worker's, not beside them under the browser's.
const continued = (request: Request) =>
  Effect.currentSpan.pipe(
    Effect.map((span) => {
      const headers = new Headers(request.headers)

      for (const [name, value] of Object.entries(HttpTraceContext.toHeaders(span))) {
        headers.set(name, value)
      }

      return new Request(request, { headers })
    }),
    Effect.orElseSucceed(() => request),
  )

interface Interface {
  // Sends a request about one conversation to the place that holds it.
  readonly forward: (
    id: ConversationId,
    request: Request,
  ) => Effect.Effect<Response, AgentUnavailable>
}

// Where conversations live: one Durable Object each, named by the
// conversation's id, which answers its requests itself.
export class Conversations extends Context.Service<Conversations, Interface>()(
  "@civicdata/server/Conversations",
) {
  static readonly unavailable = Layer.succeed(
    Conversations,
    Conversations.of({ forward: () => Effect.fail(new AgentUnavailable()) }),
  )

  // Each conversation answered in this process by its own handler, made on
  // first use. Tests use it in place of Durable Objects.
  static readonly local = (make: (id: ConversationId) => (request: Request) => Promise<Response>) =>
    Layer.sync(Conversations, () => {
      const handlers = new Map<ConversationId, (request: Request) => Promise<Response>>()

      return Conversations.of({
        forward: (id, request) =>
          Effect.promise(() => {
            const handler = handlers.get(id) ?? make(id)

            handlers.set(id, handler)

            return handler(request)
          }),
      })
    })

  // The CONVERSATION Durable Object namespace, when the deployment has one.
  // Outside Workers (plain `pnpm dev:web`) there is none.
  static readonly live = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) => {
        const namespace = env.CONVERSATION

        return namespace === undefined
          ? Conversations.unavailable
          : Layer.succeed(
              Conversations,
              Conversations.of({
                forward: (id, request) =>
                  continued(request).pipe(
                    Effect.flatMap((sent) =>
                      Effect.tryPromise(() => namespace.get(namespace.idFromName(id)).fetch(sent)),
                    ),
                    Effect.tapError((error) => Effect.logWarning("Conversation failed", error)),
                    Effect.mapError(() => new AgentUnavailable()),
                  ),
              }),
            )
      }),
      Effect.orElseSucceed(() => Conversations.unavailable),
    ),
  )
}
