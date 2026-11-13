import { Source } from "@repo/domain"
import { Clock, Context, Duration, Effect, Layer, Option, Ref, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

import * as Fetch from "./Fetch.ts"

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
const budgets = {
  // No request quota is documented for public xMart. This is our budget, not a WHO limit.
  WHO: { windows: [{ count: 10, period: minute }], cooldown: minute },
  ILOSTAT: { windows: [{ count: 10, period: minute }], cooldown: minute },
  // Melodi documents 30 anonymous requests/minute. Leave headroom.
  INSEE: { windows: [{ count: 25, period: minute }], cooldown: minute },
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
} satisfies Record<string, Budget>

// A host the paper gather asks (research/Gather.ts), by its hostname. A
// hostname has a dot and a source name never does, so one limiter's name
// never stands for both.
const Host = Schema.String.check(Schema.isPattern(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/))

// What one limiter paces: a series source, or a host the paper gather asks.
export const Key = Schema.Union([Source, Host])

export type Key = typeof Key.Type

// How often the paper gather asks one host: OpenAlex at most once a second,
// PMC's bucket on AWS, which serves scripts in bulk and takes three requests
// per copy, at most four times a second, and any other host at most once
// every two seconds.
export interface Gaps {
  readonly gap: Duration.Duration
  readonly hosts: Readonly<Record<string, Duration.Duration>>
}

export const gaps: Gaps = {
  gap: Duration.seconds(2),
  hosts: {
    "api.openalex.org": Duration.seconds(1),
    "pmc-oa-opendata.s3.amazonaws.com": Duration.millis(250),
  },
}

const isHost = Schema.is(Host)

// New API adapters must choose and register their measured budget here.
// Unregistered publishers are paced conservatively until then. A host gets
// one request per gap, and a minute's rest after it refuses one.
const budget = (key: Key): Budget => {
  if (isHost(key))
    return {
      windows: [{ count: 1, period: Duration.toMillis(gaps.hosts[key] ?? gaps.gap) }],
      cooldown: minute,
    }

  return (
    Object.entries(budgets).find(([name]) => name === key)?.[1] ?? {
      windows: [{ count: 1, period: minute }],
      cooldown: minute,
    }
  )
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
// limiter's budget, if it is no more than `patience` away. Grants never go
// back in time, so concurrent callers queue behind one another.
export const take = (
  key: Key,
  { ledger, now, patience }: { ledger: Ledger; now: number; patience: number },
): { readonly slot: Slot; readonly ledger: Ledger } => {
  const { windows } = budget(key)
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

// The source or host refused a request: ask it nothing until its cooldown
// is over.
export const refuse = (key: Key, { ledger, now }: { ledger: Ledger; now: number }): Ledger => ({
  sent: ledger.sent,
  blockedUntil: Math.max(ledger.blockedUntil, now + budget(key).cooldown),
})

interface Interface {
  // A slot for one request to `key`, waiting at most `patience`.
  readonly take: (key: Key, patience: Duration.Duration) => Effect.Effect<Slot>
  // Reports that `key` refused a request with a 429.
  readonly refused: (key: Key) => Effect.Effect<void>
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
  ["xmart-api-public.who.int", "WHO"],
  ["bulks-faostat.fao.org", "FAOSTAT"],
  ["api.insee.fr", "INSEE"],
  ["rplumber.ilo.org", "ILOSTAT"],
  ["api.worldbank.org", "World Bank"],
  ["ec.europa.eu", "Eurostat"],
  ["sdmx.oecd.org", "OECD"],
])

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
