import { ConversationApi } from "@civicdata/domain"
import type { DurableObjectState } from "@cloudflare/workers-types"
import { Effect, Layer, ManagedRuntime } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

import { Agent } from "./Agent.ts"
import { Answers } from "./Answers.ts"
import { AskLimit } from "./AskLimit.ts"
import { Catalog } from "./Catalog.ts"
import { Conversation } from "./Conversation.ts"
import { Directions } from "./Directions.ts"
import { Notes } from "./Notes.ts"
import { Politics } from "./Politics.ts"
import { Resolver } from "./Resolver.ts"
import { Sdmx } from "./Sdmx.ts"
import * as Traces from "./Traces.ts"
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
    // Worker passes the request on unchanged. A question opens the
    // conversation before it is counted, so a first question over the limit
    // still keeps it. Every span the question makes, the answer's included,
    // names the conversation, so a trace can be found by it.
    return handlers
      .handle("turns", () => conversation.turns)
      .handle("answer", () => conversation.follow)
      .handle("stop", () => conversation.stop)
      .handle("show", ({ params, payload }) =>
        conversation.show(params.turn, { chart: params.chart, view: payload }),
      )
      .handle("vote", ({ params, payload }) => conversation.vote(params.turn, payload))
      .handle("act", ({ params, payload }) => conversation.act(params.turn, payload.action))
      .handle("ask", ({ params, payload, request }) =>
        conversation.open.pipe(
          Effect.andThen(limit.count(request.headers["cf-connecting-ip"] ?? "unknown")),
          Effect.andThen(conversation.ask(payload.question)),
          Effect.annotateSpans("gen_ai.conversation.id", params.id),
        ),
      )
  }),
)

// What one conversation serves, needing a Conversation and an AskLimit.
const serve = HttpApiBuilder.layer(ConversationApi).pipe(
  Layer.provide(Handlers),
  Layer.provide(HttpServer.layerServices),
)

// The handlers Cloudflare calls on a Durable Object.
interface DurableObject {
  readonly fetch: (request: Request) => Promise<Response>
  readonly alarm: () => Promise<void>
}

// One conversation's requests and alarm, given an Agent, an AskLimit, a
// Transcript and Answers. Both reach the same Conversation, so the alarm
// knows whether an answer is running. It is built on first use. Each request
// and alarm sends its spans to a tracer of its own (Traces.serve); an
// answer's spans go with the request that asked it, until its reader leaves.
export const open = (
  layer: Layer.Layer<Agent | AskLimit | Transcript | Answers>,
  { tracer = Traces.layer }: Traces.ServeOptions = {},
): DurableObject => {
  const runtime = ManagedRuntime.make(Conversation.layer.pipe(Layer.provideMerge(layer)))

  const { handler } = HttpRouter.toWebHandler(
    serve.pipe(Layer.provide(Layer.effectContext(runtime.contextEffect))),
  )

  return {
    fetch: Traces.serve(handler, { tracer }),
    alarm: () =>
      runtime.runPromise(
        Conversation.use((conversation) => conversation.expire).pipe(Effect.provide(tracer)),
      ),
  }
}

// The Durable Object holding one conversation, named by its id. The Worker
// passes it every request about that conversation. Its storage holds the
// transcript until the alarm, set `keep` after the last question, deletes it.
export class ConversationObject implements DurableObject {
  readonly #state: DurableObjectState
  #conversation: DurableObject | undefined

  constructor(state: DurableObjectState) {
    this.#state = state
  }

  // Built on the first request or alarm: Workers forbid timers and random
  // values outside one. An alarm on a fresh object finds no answer running.
  get #opened() {
    this.#conversation ??= open(
      Layer.mergeAll(
        Transcript.durable(this.#state.storage),
        Agent.live.pipe(Layer.provide(Resolver.layer)),
        AskLimit.live,
        Answers.live(this.#state.id.toString()),
      ).pipe(
        Layer.provide(Catalog.live),
        Layer.provide(Politics.live),
        Layer.provide(Notes.live),
        Layer.provide(WorldBank.live),
        Layer.provide(Sdmx.live),
        Layer.provide(Directions.live),
      ),
    )

    return this.#conversation
  }

  fetch(request: Request) {
    return this.#opened.fetch(request)
  }

  alarm() {
    return this.#opened.alarm()
  }
}
