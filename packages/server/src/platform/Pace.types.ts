import type { Duration } from "effect"

// How often a source may be asked: at most `count` requests in any `period`
// milliseconds for each window, and nothing for `cooldown` milliseconds after
// it refuses us with a 429.
export interface Budget {
  readonly windows: ReadonlyArray<{ readonly count: number; readonly period: number }>
  readonly cooldown: number
}

// How often the paper gather asks one host: OpenAlex at most once a second,
// PMC's bucket on AWS, which serves scripts in bulk and takes three requests
// per copy, at most four times a second, and any other host at most once
// every two seconds.
export interface Gaps {
  readonly gap: Duration.Duration
  readonly hosts: Readonly<Record<string, Duration.Duration>>
}

// What a limiter needs from the PACE Durable Object namespace binding.
export interface Namespace {
  readonly idFromName: (name: string) => import("@cloudflare/workers-types").DurableObjectId
  readonly get: (id: import("@cloudflare/workers-types").DurableObjectId) => {
    readonly fetch: (request: Request) => Promise<Response>
  }
}
