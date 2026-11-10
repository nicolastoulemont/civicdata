import { ConversationApi } from "@civicdata/domain"
import type { DurableObjectState } from "@cloudflare/workers-types"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

import { Agent } from "./Agent.ts"
import { AskLimit } from "./AskLimit.ts"
import { Catalog } from "./Catalog.ts"
import { Conversation } from "./Conversation.ts"
import { Politics } from "./Politics.ts"
import { Resolver } from "./Resolver.ts"
import { Sdmx } from "./Sdmx.ts"
import { Transcript } from "./Transcript.ts"
import { WorldBank } from "./WorldBank.ts"

const Handlers = HttpApiBuilder.group(
  ConversationApi,
  "conversation",
  Effect.fn(function* (handlers) {
    const conversation = yield* Conversation
    const limit = yield* AskLimit

    // The object is the conversation, so the id in the path is not needed
    // here. Cloudflare sets cf-connecting-ip to the visitor's address, and the
    // Worker passes the request on unchanged.
    return handlers
      .handle("turns", () => conversation.turns)
      .handle("answer", () => conversation.follow)
      .handle("stop", () => conversation.stop)
      .handle("show", ({ params, payload }) =>
        conversation.show(params.turn, { chart: params.chart, view: payload }),
      )
      .handle("ask", ({ payload, request }) =>
        limit
          .count(request.headers["cf-connecting-ip"] ?? "unknown")
          .pipe(Effect.andThen(conversation.ask(payload.question))),
      )
  }),
)

// What one conversation serves, needing an Agent, an AskLimit and a Transcript.
export const serve = HttpApiBuilder.layer(ConversationApi).pipe(
  Layer.provide(Handlers),
  Layer.provide(Conversation.layer),
  Layer.provide(HttpServer.layerServices),
)

// The handlers Cloudflare calls on a Durable Object.
interface DurableObject {
  readonly fetch: (request: Request) => Promise<Response>
  readonly alarm: () => Promise<void>
}

// The Durable Object holding one conversation, named by its id. The Worker
// passes it every request about that conversation. Its storage holds the
// transcript until the alarm, set `keep` after the last question, deletes it.
export class ConversationObject implements DurableObject {
  readonly #state: DurableObjectState
  #handler: ((request: Request) => Promise<Response>) | undefined

  constructor(state: DurableObjectState) {
    this.#state = state
  }

  // Built on the first request: Workers forbid timers and random values
  // outside one.
  fetch(request: Request) {
    this.#handler ??= HttpRouter.toWebHandler(
      serve.pipe(
        Layer.provide(Transcript.durable(this.#state.storage)),
        Layer.provide(Agent.live.pipe(Layer.provide(Resolver.layer))),
        Layer.provide(AskLimit.live),
        Layer.provide(Catalog.live),
        Layer.provide(Politics.live),
        Layer.provide(WorldBank.live),
        Layer.provide(Sdmx.live),
      ),
    ).handler

    return this.#handler(request)
  }

  alarm() {
    return this.#state.storage.deleteAll()
  }
}
