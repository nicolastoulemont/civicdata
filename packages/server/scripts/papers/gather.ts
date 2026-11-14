// The local gather: runs the shared paper gather (src/research/Gather.ts)
// on a machine, step by step at once, against a stage's paper store over
// Cloudflare's D1 and R2 APIs. It gathers more works at once than the
// Workflow, and still paces each host, Cloudflare's API included.
import { Duration, Layer, Option, type Redacted } from "effect"

import { gaps } from "../../src/platform/constants/gaps.ts"
import { type Gaps } from "../../src/platform/Pace.types.ts"
import { Step } from "../../src/platform/Step.ts"
import { Bucket } from "../../src/research/Bucket.ts"
import { Outcome } from "../../src/research/Gather.schemas.ts"
import { keyed, paced, sources } from "../../src/research/Gather.ts"
import { type Fetched, type Limits, type Report } from "../../src/research/Gather.types.ts"
import { d1 } from "../d1.ts"

export interface Stage {
  readonly account: string
  readonly database: string
  readonly bucket: string
  readonly token: Redacted.Redacted
}

// A machine gathers more works at once and in larger steps than a Workflow.
export const limits: Partial<Limits> = { batch: 50, concurrency: 8 }

// The key's daily budget pays for search pages and cached PDFs alike, and a
// cached PDF costs as much as 100 pages: 50 of them leave a full fill's
// searches room in one day's budget.
export const caps: Partial<Fetched> = { cached: 50 }

// The Workflow's pacing, and Cloudflare's API: it takes 1,200 requests in
// five minutes from one user, and D1's HTTP API sends one per statement.
const pacing: Gaps = {
  ...gaps,
  hosts: { ...gaps.hosts, "api.cloudflare.com": Duration.millis(260) },
}

// The gather's services over the caller's HTTP client: the stage's store,
// OpenAlex and the licence pages, and steps that run at once. `openalex`
// signs OpenAlex's requests (`keyed`).
export const local = (
  { account, database, bucket, token }: Stage,
  options: {
    readonly pacing?: Gaps
    readonly openalex?: Option.Option<Redacted.Redacted>
  } = {},
) => {
  const store = d1({ account, database, token })

  return {
    usage: store.usage,
    layer: Layer.mergeAll(
      store.layer,
      Bucket.r2({ account, bucket, token }),
      sources,
      Step.immediate,
    ).pipe(
      Layer.provide(paced(options.pacing ?? pacing)),
      Layer.provide(keyed(options.openalex ?? Option.none())),
    ),
  }
}

// The run's report: counts per outcome, each topic, and every work that
// failed or that the store refused, without any paper text.
export const summaryOf = (report: Report) => {
  const count = (is: (outcome: Outcome) => boolean) =>
    report.works.filter(({ outcome }) => is(outcome)).length

  return {
    works: report.works.length,
    outcomes: {
      Text: count(Outcome.guards.Text),
      Metadata: count(Outcome.guards.Metadata),
      Covered: count(Outcome.guards.Covered),
      Refused: count(Outcome.guards.Refused),
      Failed: count(Outcome.guards.Failed),
    },
    topics: report.topics,
    problems: report.works.filter(
      ({ outcome }) => Outcome.guards.Failed(outcome) || Outcome.guards.Refused(outcome),
    ),
  }
}
