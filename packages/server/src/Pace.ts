import type { Source } from "@civicdata/domain"
import { Clock, Context, Duration, Effect, Layer, Ref, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http"

const minute = 60_000
const hour = 60 * minute

// How often a source may be asked: at most `count` requests in any `period`
// milliseconds for each window, and nothing for `cooldown` milliseconds after
// it refuses us with a 429.
interface Budget {
  readonly windows: ReadonlyArray<{ readonly count: number; readonly period: number }>
  readonly cooldown: number
}

// Workers send from one IP shared with every other Worker (NTO-89), so these
// budgets leave room for traffic that is not ours.
const budgets: Record<Source, Budget> = {
  // OECD refused the Workers' IP after about 20 requests in a minute, and for
  // five minutes after about 60 in ten. It documents 60 an hour.
  OECD: {
    windows: [
      { count: 15, period: minute },
      { count: 50, period: hour },
    ],
    cooldown: 5 * minute,
  },
  // Eurostat answered 540 requests in a minute without refusing one.
  Eurostat: { windows: [{ count: 60, period: minute }], cooldown: minute },
  // The World Bank documents no limit.
  "World Bank": { windows: [{ count: 120, period: minute }], cooldown: minute },
}

// What a source's limiter remembers: when it let each recent request go,
// oldest first, and until when the source is refusing us.
export const Ledger = Schema.Struct({
  sent: Schema.Array(Schema.Finite),
  blockedUntil: Schema.Finite,
})

export interface Ledger extends Schema.Schema.Type<typeof Ledger> {}

export const empty: Ledger = { sent: [], blockedUntil: 0 }

// A limiter's answer: the request may go after `wait` milliseconds, or the
// next free slot is further away than the caller is willing to wait.
export const Slot = Schema.TaggedUnion({
  Granted: { wait: Schema.Finite },
  Full: { wait: Schema.Finite },
})

export type Slot = typeof Slot.Type

// Grants the earliest time at or after `now` that keeps every window of the
// source's budget, if it is no more than `patience` away. Grants never go
// back in time, so concurrent callers queue behind one another.
export const take = (
  source: Source,
  { ledger, now, patience }: { ledger: Ledger; now: number; patience: number },
): { readonly slot: Slot; readonly ledger: Ledger } => {
  const { windows } = budgets[source]
  const longest = Math.max(...windows.map((window) => window.period))
  const sent = ledger.sent.filter((at) => at > now - longest)

  const at = Math.max(
    now,
    ledger.blockedUntil,
    sent.at(-1) ?? 0,
    ...windows.map(({ count, period }) => (sent[sent.length - count] ?? -Infinity) + period),
  )

  const { blockedUntil } = ledger

  return at - now > patience
    ? { slot: Slot.cases.Full.make({ wait: at - now }), ledger: { sent, blockedUntil } }
    : {
        slot: Slot.cases.Granted.make({ wait: at - now }),
        ledger: { sent: [...sent, at], blockedUntil },
      }
}

// The source refused a request: ask it nothing until its cooldown is over.
export const refuse = (
  source: Source,
  { ledger, now }: { ledger: Ledger; now: number },
): Ledger => ({
  sent: ledger.sent,
  blockedUntil: Math.max(ledger.blockedUntil, now + budgets[source].cooldown),
})

interface Interface {
  // A slot for one request to `source`, waiting at most `patience`.
  readonly take: (source: Source, patience: Duration.Duration) => Effect.Effect<Slot>
  // Reports that `source` refused a request with a 429.
  readonly refused: (source: Source) => Effect.Effect<void>
}

// What a limiter needs from the PACE Durable Object namespace binding.
export interface Namespace {
  readonly idFromName: (name: string) => import("@cloudflare/workers-types").DurableObjectId
  readonly get: (id: import("@cloudflare/workers-types").DurableObjectId) => {
    readonly fetch: (request: Request) => Promise<Response>
  }
}

const SlotJson = Schema.fromJsonString(Slot)

// The hosts each adapter asks, so one HttpClient paces them all.
export const hosts = new Map<string, Source>([
  ["api.worldbank.org", "World Bank"],
  ["ec.europa.eu", "Eurostat"],
  ["sdmx.oecd.org", "OECD"],
])

// How long a request may wait for a slot before it fails as refused.
const hold = Duration.seconds(2)

// Paces the requests the app sends to each source, so that all its Workers
// together stay within the source's limits.
export class Pace extends Context.Service<Pace, Interface>()("@civicdata/server/Pace") {
  // Limiters in this process only: tests, and plain `pnpm dev:web`.
  static readonly memory = Layer.effect(
    Pace,
    Effect.gen(function* () {
      const ledgers = yield* Ref.make(new Map<Source, Ledger>())

      return Pace.of({
        take: (source, patience) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Ref.modify(ledgers, (all) => {
              const next = take(source, {
                ledger: all.get(source) ?? empty,
                now,
                patience: Duration.toMillis(patience),
              })

              return [next.slot, new Map(all).set(source, next.ledger)]
            }),
          ),
        refused: (source) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Ref.update(ledgers, (all) =>
              new Map(all).set(source, refuse(source, { ledger: all.get(source) ?? empty, now })),
            ),
          ),
      })
    }),
  )

  // One PaceObject per source, shared by every Worker. A limiter that fails
  // lets the request through: a broken counter should not take a source down.
  static readonly durable = (namespace: Namespace) => {
    const ask = (source: Source, path: string) =>
      Effect.tryPromise(() =>
        namespace
          .get(namespace.idFromName(source))
          .fetch(new Request(`https://pace${path}`, { method: "POST" })),
      )

    return Layer.succeed(
      Pace,
      Pace.of({
        take: (source, patience) =>
          ask(
            source,
            `/take?source=${encodeURIComponent(source)}&patience=${Duration.toMillis(patience)}`,
          ).pipe(
            Effect.flatMap((response) => Effect.tryPromise(() => response.text())),
            Effect.flatMap(Schema.decodeEffect(SlotJson)),
            Effect.tapError((error) => Effect.logWarning("Pace failed", source, error)),
            Effect.orElseSucceed(() => Slot.cases.Granted.make({ wait: 0 })),
          ),
        refused: (source) =>
          ask(source, `/refused?source=${encodeURIComponent(source)}`).pipe(
            Effect.tapError((error) => Effect.logWarning("Pace failed", source, error)),
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

  // Wraps the HttpClient the adapters use. A request waits for its source's
  // slot; when none is free within two seconds, it gets a 429 without leaving
  // the Worker, which the adapters already read as the source refusing. A
  // real 429 from the source starts its cooldown.
  static readonly client = Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      const pace = yield* Pace

      return HttpClient.transform(client, (send, request) => {
        const source = hosts.get(new URL(request.url).host)

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

  // What the adapters send through when deployed: fetch, paced.
  static readonly http = Pace.client.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Pace.live),
  )
}
