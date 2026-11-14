import type { caps } from "./constants/caps.ts"
import type { Gathered } from "./Gather.schemas.ts"

// How much one run asks for. A page and a batch hold at most 100 works:
// D1 binds at most 100 parameters, and OpenAlex filters at most 100 ids.
export interface Limits {
  // Pages of search results per topic.
  readonly pages: number
  // Works per page.
  readonly size: number
  // Works per gather step.
  readonly batch: number
  // Works gathered at once within a step.
  readonly concurrency: number
  // Failed attempts on one record before the work waits for its record to
  // change.
  readonly attempts: number
}

// What a run fetched, and the most it may fetch: requests to OpenAlex
// (search pages and batches of records), works gathered, PDFs downloaded and
// their bytes, and of those PDFs the ones OpenAlex cached, which cost the
// key's budget.
export interface Fetched {
  readonly requests: number
  readonly works: number
  readonly pdfs: number
  readonly bytes: number
  readonly cached: number
}

export type Cap = (typeof caps)[number]

// What a run did with one topic: the day it searched from (null for every
// year), the works its pages listed, the records that did not decode, the
// works the ledger already held unchanged, the works it asked for, those
// another run held or a cap left waiting, those that failed, whether a cap
// stopped it before its search or its works were done, and what failed.
export interface Searched {
  readonly key: string
  readonly query: string
  readonly since: string | null
  readonly found: number
  readonly skipped: number
  readonly unchanged: number
  readonly wanted: number
  readonly held: number
  readonly waiting: number
  readonly failed: number
  readonly capped: boolean
  readonly problem: string | null
}

// What a run did: per topic, what its search found and left; per work it
// asked for, the outcome; what it fetched; and the cap that stopped it, if
// one did. A failure names the work and the problem, never the paper's text.
export interface Report {
  readonly topics: ReadonlyArray<Searched>
  readonly works: ReadonlyArray<typeof Gathered.Type>
  readonly fetched: Fetched
  readonly stopped: Cap | null
}
