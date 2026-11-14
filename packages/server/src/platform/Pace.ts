import { Clock, Context, Duration, Effect, Layer, Option, Ref, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

import { empty } from "./constants/empty.ts"
import { hosts } from "./constants/hosts.ts"
import * as Fetch from "./Fetch.ts"
import { Host, type Key, type Ledger, Slot } from "./Pace.schemas.ts"
import type { Namespace } from "./Pace.types.ts"
import { refuse } from "./utils/refuse.ts"
import { take } from "./utils/take.ts"

interface Interface {
  // A slot for one request to `key`, waiting at most `patience`.
  readonly take: (key: Key, patience: Duration.Duration) => Effect.Effect<Slot>
  // Reports that `key` refused a request with a 429.
  readonly refused: (key: Key) => Effect.Effect<void>
}

const SlotJson = Schema.fromJsonString(Slot)

// Paces the requests the app sends to each source, so that all its Workers
// together stay within the source's limits.
export class Pace extends Context.Service<Pace, Interface>()("@repo/server/Pace") {
  // Limiters in this process only: tests, and plain `pnpm dev:web`.
  static readonly memory = Layer.effect(
    Pace,
    Effect.gen(function* () {
      const ledgers = yield* Ref.make(new Map<Key, Ledger>())

      return Pace.of({
        take: (key, patience) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Ref.modify(ledgers, (all) => {
              const next = take(key, {
                ledger: all.get(key) ?? empty,
                now,
                patience: Duration.toMillis(patience),
              })

              return [next.slot, new Map(all).set(key, next.ledger)]
            }),
          ),
        refused: (key) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Ref.update(ledgers, (all) =>
              new Map(all).set(key, refuse(key, { ledger: all.get(key) ?? empty, now })),
            ),
          ),
      })
    }),
  )

  // One PaceObject per source or host, shared by every Worker. A limiter
  // that fails lets the request through: a broken counter should not take a
  // source down.
  static readonly durable = (namespace: Namespace) => {
    const ask = (key: Key, path: string) =>
      Effect.tryPromise(() =>
        namespace
          .get(namespace.idFromName(key))
          .fetch(new Request(`https://pace${path}`, { method: "POST" })),
      )

    return Layer.succeed(
      Pace,
      Pace.of({
        take: (key, patience) =>
          ask(
            key,
            `/take?source=${encodeURIComponent(key)}&patience=${Duration.toMillis(patience)}`,
          ).pipe(
            Effect.flatMap((response) => Effect.tryPromise(() => response.text())),
            Effect.flatMap(Schema.decodeEffect(SlotJson)),
            Effect.tapError((error) => Effect.logWarning("Pace failed", key, error)),
            Effect.orElseSucceed(() => Slot.cases.Granted.make({ wait: 0 })),
          ),
        refused: (key) =>
          ask(key, `/refused?source=${encodeURIComponent(key)}`).pipe(
            Effect.tapError((error) => Effect.logWarning("Pace failed", key, error)),
            Effect.ignore,
          ),
      }),
    )
  }

  // The PACE binding inside Workers, else limiters in this process.
  static readonly live = Layer.unwrap(
    Effect.tryPromise(() => import("cloudflare:workers")).pipe(
      Effect.map(({ env }) => (env.PACE === undefined ? Pace.memory : Pace.durable(env.PACE))),
      Effect.orElseSucceed(() => Pace.memory),
    ),
  )

  // Wraps the HttpClient the adapters use. A request waits for its
  // limiter's slot; when none is free within `hold`, it gets a 429 without
  // leaving the Worker, which the adapters already read as the source
  // refusing. A real 429 from the source starts its cooldown. `limiter`
  // names the limiter of a request's hostname, or none to send it unpaced;
  // by default each series source's hosts share the source's.
  static readonly paced = (
    hold: Duration.Duration,
    limiter: (hostname: string) => Key | undefined = (hostname) => hosts.get(hostname),
  ) =>
    Layer.effect(
      HttpClient.HttpClient,
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient
        const pace = yield* Pace

        return HttpClient.transform(client, (send, request) => {
          const source = limiter(new URL(request.url).hostname)

          if (source === undefined) return send

          return pace.take(source, hold).pipe(
            Effect.flatMap((slot) =>
              Slot.match(slot, {
                Granted: ({ wait }) =>
                  Effect.sleep(Duration.millis(wait)).pipe(
                    Effect.andThen(send),
                    Effect.tap((response) =>
                      response.status === 429 ? pace.refused(source) : Effect.void,
                    ),
                  ),
                Full: () =>
                  Effect.succeed(
                    HttpClientResponse.fromWeb(
                      request,
                      new Response("Paced: this source's request budget is spent", { status: 429 }),
                    ),
                  ),
              }),
            ),
          )
        })
      }),
    )

  // A request for a visitor waits at most two seconds for a slot.
  static readonly client = Pace.paced(Duration.seconds(2))

  // What the adapters send through when deployed: fetch, paced.
  static readonly http = Pace.client.pipe(Layer.provide(Fetch.layer), Layer.provide(Pace.live))

  // What a gathering run sends through. Nobody waits on it, so a request
  // waits up to ten seconds for a slot.
  static readonly gathering = Pace.paced(Duration.seconds(10)).pipe(
    Layer.provide(Fetch.layer),
    Layer.provide(Pace.live),
  )

  // Paces each host on its own, as the paper gather asks them: every Worker
  // and every run shares one limiter per host. A request waits up to a
  // minute for a slot, about 30 requests queued ahead of it on one
  // publisher.
  static readonly hosts = Pace.paced(Duration.minutes(1), (hostname) =>
    Option.getOrUndefined(Schema.decodeOption(Host)(hostname)),
  ).pipe(Layer.provide(Pace.live))
}
